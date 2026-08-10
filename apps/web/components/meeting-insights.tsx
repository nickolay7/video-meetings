'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Chip, ScrollShadow, Spinner } from '@heroui/react';
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
 */
export function MeetingInsights({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [status, setStatus] = useState<InsightsStatus | 'none'>('none');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(true);

  const getToken = useCallback((): string | null => {
    return localStorage.getItem('access_token');
  }, []);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem('access_token');
    router.push('/login');
  }, [router]);

  /** Ищет файл с завершёнными инсайтами в списке файлов встречи. */
  const findInsightsFile = useCallback(async (): Promise<string | null> => {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return null;
    }

    try {
      const filesRes = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (filesRes.status === 401) {
        handleUnauthorized();
        return null;
      }
      if (!filesRes.ok) {
        return null;
      }

      const files: MeetingFile[] = await filesRes.json();
      for (const file of files) {
        const statusRes = await fetch(
          `${API_URL}/meetings/${meetingId}/files/${file.id}/insights/status`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (statusRes.status === 401) {
          handleUnauthorized();
          return null;
        }
        if (statusRes.ok) {
          const data: { status: string; error?: string } = await statusRes.json();
          if (data.status === 'completed') {
            return file.id;
          }
          if (
            data.status === 'queued' ||
            data.status === 'processing' ||
            data.status === 'failed'
          ) {
            setStatus(data.status);
            if (data.status === 'failed' && data.error) {
              setError(data.error);
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }, [meetingId, getToken, handleUnauthorized]);

  /** Загружает данные инсайтов для указанного файла. */
  const loadInsights = useCallback(
    async (fileId: string) => {
      const token = getToken();
      if (!token) {
        handleUnauthorized();
        return;
      }

      try {
        const res = await fetch(`${API_URL}/meetings/${meetingId}/files/${fileId}/insights`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (res.ok) {
          const data: InsightsData = await res.json();
          setInsights(data);
          setStatus('completed');
          setError(null);
          setIsLoading(false);
        }
      } catch {
        // silent
      }
    },
    [meetingId, getToken, handleUnauthorized],
  );

  /** Проверяет статус инсайтов для всех файлов встречи. */
  const checkStatus = useCallback(async () => {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    try {
      const filesRes = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (filesRes.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!filesRes.ok) {
        return;
      }

      const files: MeetingFile[] = await filesRes.json();
      for (const file of files) {
        const statusRes = await fetch(
          `${API_URL}/meetings/${meetingId}/files/${file.id}/insights/status`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (statusRes.status === 401) {
          handleUnauthorized();
          return;
        }
        if (statusRes.ok) {
          const data: { status: string; error?: string } = await statusRes.json();
          if (data.status === 'completed') {
            // Инсайты готовы — загружаем данные и останавливаем опрос
            await loadInsights(file.id);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            return;
          }
          if (data.status === 'queued' || data.status === 'processing') {
            setStatus(data.status);
            setError(null);
            return;
          }
          if (data.status === 'failed') {
            setStatus('failed');
            setError(data.error ?? 'Ошибка генерации инсайтов');
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            return;
          }
        }
      }
    } catch {
      // silent
    }
  }, [meetingId, getToken, handleUnauthorized, loadInsights]);

  useEffect(() => {
    activeRef.current = true;

    async function init() {
      const fileId = await findInsightsFile();
      if (!activeRef.current) {
        return;
      }

      if (fileId) {
        await loadInsights(fileId);
      } else if (status === 'queued' || status === 'processing' || status === 'none') {
        // Если есть файлы с не-терминальным статусом — начинаем опрос
        setIsLoading(false);
        pollIntervalRef.current = setInterval(() => {
          void checkStatus();
        }, INSIGHTS_POLL_INTERVAL_MS);
      } else {
        setIsLoading(false);
      }
    }

    void init();

    return () => {
      activeRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
    // Только при монтировании
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
