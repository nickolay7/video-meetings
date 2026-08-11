'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Spinner } from '@heroui/react';
import { InsightsData, InsightsStatus } from '../lib/transcription';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const INSIGHTS_POLL_INTERVAL_MS = 2500;

interface MeetingFile {
  id: string;
  meetingId: string;
  originalName: string;
}

/**
 * Блок «Инсайты встречи» в карточке встречи.
 * Показывает summary, action items и decisions после завершения генерации.
 *
 * Опрос ведётся только пока есть реальная работа: генерация в процессе (queued/
 * processing), либо идёт транскрибация, по завершении которой генерация начнётся
 * автоматически. Терминальные состояния (completed/failed/нечего ждать) останавливают опрос.
 */
export function MeetingInsights({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [status, setStatus] = useState<InsightsStatus | 'none'>('none');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(true);
  /** fileId файла с неудавшейся генерацией — цель кнопки «Повторить». */
  const failedFileIdRef = useRef<string | null>(null);

  const getToken = useCallback((): string | null => {
    return localStorage.getItem('access_token');
  }, []);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem('access_token');
    router.push('/login');
  }, [router]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Загружает данные инсайтов для указанного файла. Возвращает успех: при неудаче
   * вызывающий код продолжает опрос, чтобы повторить загрузку.
   */
  const loadInsights = useCallback(
    async (fileId: string): Promise<boolean> => {
      const token = getToken();
      if (!token) {
        handleUnauthorized();
        return false;
      }

      try {
        const res = await fetch(`${API_URL}/meetings/${meetingId}/files/${fileId}/insights`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          handleUnauthorized();
          return false;
        }
        if (res.ok) {
          const data: InsightsData = await res.json();
          setInsights(data);
          setStatus('completed');
          setError(null);
          setIsLoading(false);
          return true;
        }
      } catch {
        // Транзиентная ошибка сети — вернём false, инициатор продолжит опрос
      }
      setIsLoading(false);
      return false;
    },
    [meetingId, getToken, handleUnauthorized],
  );

  /**
   * Проверяет статусы инсайтов всех файлов встречи и обновляет состояние.
   * Возвращает `true`, если опрос стоит продолжать: идёт генерация, либо файл
   * завершён, но данные ещё не загрузились (повторная попытка), либо транскрибация
   * в работе и инсайты появятся позже.
   */
  const checkStatus = useCallback(async (): Promise<boolean> => {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return false;
    }

    let files: MeetingFile[];
    try {
      const filesRes = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (filesRes.status === 401) {
        handleUnauthorized();
        return false;
      }
      if (!filesRes.ok) {
        return false;
      }
      files = await filesRes.json();
    } catch {
      // Транзиентная ошибка сети: продолжаем опрос, только если он уже идёт, —
      // при инициализации по ошибке опрос не начинаем (иначе вечный поллинг без работы).
      return pollIntervalRef.current !== null;
    }

    let hasActive = false;
    let hasFailed = false;
    let failedError: string | null = null;

    for (const file of files) {
      const insightsRes = await fetch(
        `${API_URL}/meetings/${meetingId}/files/${file.id}/insights/status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (insightsRes.status === 401) {
        handleUnauthorized();
        return false;
      }
      if (!insightsRes.ok) {
        continue;
      }

      const insightsData: { status: string; error?: string } = await insightsRes.json();

      if (insightsData.status === 'completed') {
        // Инсайты готовы — загружаем данные. Продолжаем опрос, если загрузка не удалась.
        const loaded = await loadInsights(file.id);
        return !loaded;
      }
      if (insightsData.status === 'queued' || insightsData.status === 'processing') {
        hasActive = true;
        setStatus(insightsData.status);
        setError(null);
        continue;
      }
      if (insightsData.status === 'failed') {
        hasFailed = true;
        failedFileIdRef.current = file.id;
        failedError = insightsData.error ?? null;
        continue;
      }

      // Статус 'none' — инсайты ещё не запущены. Опрос оправдан, только если файл
      // транскрибируется или уже оттранскрибирован: по завершении генерация начнётся.
      const transcriptionRes = await fetch(
        `${API_URL}/meetings/${meetingId}/files/${file.id}/transcription/status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (transcriptionRes.ok) {
        const transcriptionData: { status: string } = await transcriptionRes.json();
        if (
          transcriptionData.status === 'queued' ||
          transcriptionData.status === 'processing' ||
          transcriptionData.status === 'completed'
        ) {
          hasActive = true;
        }
      }
    }

    if (hasActive) {
      return true;
    }
    if (hasFailed) {
      setStatus('failed');
      setError(failedError ?? 'Не удалось сгенерировать инсайты');
      return false;
    }
    // Нечего ждать — останавливаем опрос.
    return false;
  }, [meetingId, getToken, handleUnauthorized, loadInsights]);

  /** Перезапускает генерацию инсайтов для файла, упавшего в failed. */
  const retryGeneration = useCallback(async () => {
    const fileId = failedFileIdRef.current;
    if (!fileId) {
      return;
    }
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/meetings/${meetingId}/files/${fileId}/insights/regenerate`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        setStatus('queued');
        setError(null);
        setIsLoading(false);
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(() => {
            void checkStatus().then((continuePolling) => {
              if (!continuePolling) {
                stopPolling();
              }
            });
          }, INSIGHTS_POLL_INTERVAL_MS);
        }
      }
    } catch {
      // Тихо: следующий опрос/повторный клик подхватит актуальный статус
    }
  }, [meetingId, getToken, handleUnauthorized, checkStatus, stopPolling]);

  useEffect(() => {
    activeRef.current = true;

    async function init() {
      setIsLoading(false);
      const shouldPoll = await checkStatus();
      if (!activeRef.current) {
        return;
      }
      if (shouldPoll && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(() => {
          void checkStatus().then((continuePolling) => {
            if (!continuePolling) {
              stopPolling();
            }
          });
        }, INSIGHTS_POLL_INTERVAL_MS);
      }
    }

    void init();

    return () => {
      activeRef.current = false;
      stopPolling();
    };
    // Только при монтировании: правило exhaustive-deps в конфиге репозитория не подключено
  }, []);

  // Не показываем ничего, если нет данных и не в процессе
  if (isLoading) {
    return null;
  }

  if (status === 'none' && !insights) {
    return null;
  }

  if (status === 'queued' || status === 'processing') {
    return (
      <div className="bg-warning/10 mt-3 flex items-center gap-2 rounded-lg px-3 py-2">
        <Spinner size="sm" color="warning" />
        <span className="text-warning text-sm">Генерируем инсайты…</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="bg-danger/10 mt-3 rounded-lg px-3 py-2">
        <p className="text-danger text-sm">{error ?? 'Не удалось сгенерировать инсайты'}</p>
        <Button size="sm" variant="outline" onPress={() => void retryGeneration()} className="mt-2">
          Повторить
        </Button>
      </div>
    );
  }

  if (!insights) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Summary */}
      {insights.summary && (
        <div className="bg-accent/5 rounded-lg px-3 py-2">
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            Саммари
          </p>
          <p className="text-foreground text-sm leading-relaxed">{insights.summary}</p>
        </div>
      )}

      {/* Action Items */}
      {insights.actionItems.length > 0 && (
        <div className="bg-accent/5 rounded-lg px-3 py-2">
          <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wider uppercase">
            Задачи
          </p>
          <ol className="list-inside list-decimal space-y-1">
            {insights.actionItems.map((item, idx) => (
              <li key={idx} className="text-foreground text-sm">
                {item.text}
                {item.assignee && (
                  <span className="text-muted-foreground ml-1 text-xs">— {item.assignee}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Decisions */}
      {insights.decisions.length > 0 && (
        <div className="bg-accent/5 rounded-lg px-3 py-2">
          <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wider uppercase">
            Решения
          </p>
          <ol className="list-inside list-decimal space-y-1">
            {insights.decisions.map((item, idx) => (
              <li key={idx} className="text-foreground text-sm">
                {item.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
