'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Chip, Modal, ScrollShadow, Spinner } from '@heroui/react';
import { formatBytes, formatFileDate, formatFileType } from '../../lib/format';
import {
  isTranscribableFile,
  TranscriptionInfo,
  TranscriptionStatus,
  TranscriptionStatusResponse,
} from '../../lib/transcription';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MAX_FILE_SIZE_MB = 20;
/** Интервал опроса статуса транскрибации в миллисекундах. */
const TRANSCRIPTION_POLL_INTERVAL_MS = 1000;
/**
 * Сколько подряд неудачных опросов одного файла допустимо, прежде чем опрос файла
 * прекращается — чтобы устойчивый сбой (например, после перезапуска API) не держал
 * таймер вечно.
 */
const MAX_POLL_FAILURES = 3;

interface MeetingFile {
  id: string;
  meetingId: string;
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

interface FilesModalProps {
  meetingId: string;
  meetingName: string;
}

/** Открытая в модальном окне транскрипция: загрузка / ошибка / готовый текст. */
type TranscriptionView =
  | { fileId: string; state: 'loading' }
  | { fileId: string; state: 'error'; message: string }
  | { fileId: string; state: 'ready'; text: string }
  | null;

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="text-foreground/60 size-5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

/**
 * Модальное окно «Файлы» встречи: список прикреплённых файлов (имя, размер,
 * тип, дата), загрузка нового файла, скачивание по клику на элемент списка
 * и транскрибация MP3/MP4 (запуск, статусы, просмотр текста расшифровки).
 */
export function FilesModal({ meetingId, meetingName }: FilesModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Статусы транскрибации по файлам; отсутствие записи = «ещё не транскрибировался».
  const [transcriptions, setTranscriptions] = useState<Record<string, TranscriptionInfo>>({});
  // Открытый в модалке текст транскрипции (по файлу).
  const [transcriptionView, setTranscriptionView] = useState<TranscriptionView>(null);

  // Опрос статусов: файлы в не-терминальном состоянии + общий интервал.
  // Рефы защищают от гонок: stale-континуации после закрытия модалки не перезапускают
  // опрос (modalOpenRef), тики не перекрываются (pollInFlightRef), устойчивый сбой
  // завершает опрос файла (pollFailuresRef).
  const modalOpenRef = useRef(false);
  const pollingFilesRef = useRef<Set<string>>(new Set());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollFailuresRef = useRef<Record<string, number>>({});

  useEffect(() => {
    // Останавливаем опрос при размонтировании, чтобы не утекали таймеры.
    return () => {
      modalOpenRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pollingFilesRef.current.clear();
      pollFailuresRef.current = {};
    };
  }, []);

  function getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  function handleUnauthorized() {
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  /** Останавливает опрос всех файлов и сбрасывает таймер. */
  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollingFilesRef.current.clear();
    pollFailuresRef.current = {};
  }

  /** Начинает опрос статуса файла, если модалка открыта и файл ещё не опрашивается. */
  function startPolling(fileId: string) {
    if (!modalOpenRef.current) {
      return;
    }
    pollingFilesRef.current.add(fileId);
    if (pollIntervalRef.current) {
      return;
    }
    pollIntervalRef.current = setInterval(() => {
      if (pollInFlightRef.current) {
        // Предыдущий тик ещё не завершился — пропускаем, чтобы не дублировать запросы.
        return;
      }
      void pollTranscriptionStatuses();
    }, TRANSCRIPTION_POLL_INTERVAL_MS);
  }

  /** Один тик опроса: тянет статусы всех файлов, завершившиеся — убирает из набора. */
  async function pollTranscriptionStatuses() {
    if (!modalOpenRef.current || pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;
    try {
      const token = getToken();
      if (!token) {
        handleUnauthorized();
        stopPolling();
        return;
      }

      const fileIds = [...pollingFilesRef.current];
      for (const fileId of fileIds) {
        try {
          const res = await fetch(
            `${API_URL}/meetings/${meetingId}/files/${fileId}/transcription/status`,
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (res.status === 401) {
            handleUnauthorized();
            stopPolling();
            return;
          }
          if (!res.ok) {
            // Устойчивый сбой (например, API перезапущен и стёр in-memory репозитории):
            // после MAX_POLL_FAILURES неудач подряд прекращаем опрашивать файл.
            const failures = (pollFailuresRef.current[fileId] ?? 0) + 1;
            pollFailuresRef.current[fileId] = failures;
            if (failures >= MAX_POLL_FAILURES) {
              pollingFilesRef.current.delete(fileId);
              delete pollFailuresRef.current[fileId];
            }
            continue;
          }

          pollFailuresRef.current[fileId] = 0;
          const data: TranscriptionStatusResponse = await res.json();
          if (data.status === 'none') {
            // Опрашивается только не-терминальный файл — статус «нет» считаем завершением.
            pollingFilesRef.current.delete(fileId);
            delete pollFailuresRef.current[fileId];
            continue;
          }
          const info: TranscriptionInfo = { status: data.status, error: data.error };
          setTranscriptions((prev) => ({ ...prev, [fileId]: info }));
          if (data.status === 'completed' || data.status === 'failed') {
            pollingFilesRef.current.delete(fileId);
            delete pollFailuresRef.current[fileId];
          }
        } catch {
          // Временный сбой сети — считаем неудачу и пробуем на следующем тике.
          const failures = (pollFailuresRef.current[fileId] ?? 0) + 1;
          pollFailuresRef.current[fileId] = failures;
          if (failures >= MAX_POLL_FAILURES) {
            pollingFilesRef.current.delete(fileId);
            delete pollFailuresRef.current[fileId];
          }
        }
      }
    } finally {
      pollInFlightRef.current = false;
      if (pollingFilesRef.current.size === 0 && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }

  /** Разовый запрос статуса транскрибации файла (null — файл ещё не транскрибировался). */
  async function fetchTranscriptionStatus(file: MeetingFile): Promise<TranscriptionInfo | null> {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return null;
    }

    try {
      const res = await fetch(
        `${API_URL}/meetings/${meetingId}/files/${file.id}/transcription/status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (res.status === 401) {
        handleUnauthorized();
        return null;
      }
      if (!res.ok) {
        return null;
      }

      const data: TranscriptionStatusResponse = await res.json();
      if (data.status === 'none') {
        return null;
      }
      return { status: data.status, error: data.error };
    } catch {
      return null;
    }
  }

  async function openModal() {
    modalOpenRef.current = true;
    setIsOpen(true);
    setTranscriptions({});
    setTranscriptionView(null);
    const loadedFiles = await loadFiles();
    if (loadedFiles) {
      await syncTranscriptionStatuses(loadedFiles);
    }
  }

  /** Подтягивает текущие статусы транскрибации транскрибируемых файлов при открытии. */
  async function syncTranscriptionStatuses(fileList: MeetingFile[]) {
    for (const file of fileList) {
      if (!isTranscribableFile(file)) {
        continue;
      }
      const status = await fetchTranscriptionStatus(file);
      if (status) {
        setTranscriptions((prev) => ({ ...prev, [file.id]: status }));
        if (status.status === 'queued' || status.status === 'processing') {
          startPolling(file.id);
        }
      }
    }
  }

  function handleOpenChange(next: boolean) {
    modalOpenRef.current = next;
    setIsOpen(next);
    if (!next) {
      stopPolling();
      setTranscriptions({});
      setTranscriptionView(null);
    }
  }

  async function loadFiles(): Promise<MeetingFile[] | null> {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return null;
    }

    setIsLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleUnauthorized();
        return null;
      }

      if (!res.ok) {
        setLoadFailed(true);
        setError('Не удалось загрузить список файлов. Попробуйте ещё раз.');
        return null;
      }

      const data: MeetingFile[] = await res.json();
      setFiles(data);
      return data;
    } catch {
      setLoadFailed(true);
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpload(file: File) {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    // Мгновенная проверка размера на клиенте; серверное ограничение (413) остаётся источником истины.
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Файл слишком большой. Максимальный размер — ${MAX_FILE_SIZE_MB} МБ.`);
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (res.status === 413) {
        setError(`Файл слишком большой. Максимальный размер — ${MAX_FILE_SIZE_MB} МБ.`);
        return;
      }

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!res.ok) {
        setError('Не удалось загрузить файл. Попробуйте ещё раз.');
        return;
      }

      // Новый файл появляется в списке сразу, без перезагрузки страницы.
      const uploaded: MeetingFile = await res.json();
      setFiles((prev) => [uploaded, ...prev]);
    } catch {
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    } finally {
      setIsUploading(false);
      // Сбрасываем input, чтобы повторный выбор того же файла снова срабатывал.
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  async function handleDownload(file: MeetingFile) {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    setError(null);
    try {
      const res = await fetch(`${API_URL}/meetings/${meetingId}/files/${file.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!res.ok) {
        setError('Не удалось скачать файл. Попробуйте ещё раз.');
        return;
      }

      // <a href> не отправляет Authorization-заголовок — качаем через fetch + blob.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.originalName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Откладываем revoke, иначе браузер может не успеть инициировать загрузку.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    }
  }

  async function handleTranscribe(file: MeetingFile) {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    setError(null);
    try {
      const res = await fetch(`${API_URL}/meetings/${meetingId}/files/${file.id}/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (res.status === 409) {
        // Файл уже в очереди/завершён — синхронизируем актуальный статус.
        const status = await fetchTranscriptionStatus(file);
        if (status) {
          setTranscriptions((prev) => ({ ...prev, [file.id]: status }));
          if (status.status === 'queued' || status.status === 'processing') {
            startPolling(file.id);
          }
        }
        return;
      }

      if (!res.ok) {
        setError('Не удалось запустить транскрибацию. Попробуйте ещё раз.');
        return;
      }

      setTranscriptions((prev) => ({ ...prev, [file.id]: { status: 'queued' } }));
      startPolling(file.id);
    } catch {
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    }
  }

  async function handleShowTranscription(file: MeetingFile) {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    setTranscriptionView({ fileId: file.id, state: 'loading' });
    try {
      const res = await fetch(`${API_URL}/meetings/${meetingId}/files/${file.id}/transcription`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (res.status === 409) {
        setTranscriptionView({
          fileId: file.id,
          state: 'error',
          message: 'Транскрипция ещё не готова. Попробуйте позже.',
        });
        return;
      }

      if (!res.ok) {
        setTranscriptionView({
          fileId: file.id,
          state: 'error',
          message: 'Не удалось получить текст транскрипции. Попробуйте ещё раз.',
        });
        return;
      }

      const data: { text: string } = await res.json();
      setTranscriptionView({ fileId: file.id, state: 'ready', text: data.text });
    } catch {
      setTranscriptionView({
        fileId: file.id,
        state: 'error',
        message: 'Ошибка подключения к серверу. Попробуйте ещё раз.',
      });
    }
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  }

  function renderTranscriptionStatus(status: TranscriptionStatus): React.ReactNode {
    switch (status) {
      case 'queued':
        return (
          <Chip size="sm" variant="soft" color="warning">
            В очереди
          </Chip>
        );
      case 'processing':
        return (
          <Chip size="sm" variant="soft" color="accent">
            <span className="flex items-center gap-1.5">
              <Spinner size="sm" color="current" />
              Транскрибация…
            </span>
          </Chip>
        );
      case 'completed':
        return (
          <Chip size="sm" variant="soft" color="success">
            Готово
          </Chip>
        );
      case 'failed':
        return (
          <Chip size="sm" variant="soft" color="danger">
            Ошибка
          </Chip>
        );
    }
  }

  function renderTranscriptionControls(file: MeetingFile): React.ReactNode {
    if (!isTranscribableFile(file)) {
      return null;
    }

    const status = transcriptions[file.id]?.status;
    const transcriptionError = transcriptions[file.id]?.error;
    const isCompleted = status === 'completed';

    return (
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        {status ? renderTranscriptionStatus(status) : null}

        {!isCompleted && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Транскрибировать ${file.originalName}`}
            onPress={() => void handleTranscribe(file)}
          >
            Транскрибировать
          </Button>
        )}

        {isCompleted && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Показать транскрипцию ${file.originalName}`}
            onPress={() => void handleShowTranscription(file)}
          >
            Показать транскрипцию
          </Button>
        )}

        {status === 'failed' && transcriptionError && (
          <p className="text-danger w-full text-xs break-words">{transcriptionError}</p>
        )}

        {transcriptionView?.fileId === file.id && (
          <div className="border-border/80 bg-surface mt-1 w-full rounded-lg border px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs font-medium">Транскрипция</p>
              <Button size="sm" variant="ghost" onPress={() => setTranscriptionView(null)}>
                Скрыть
              </Button>
            </div>
            {transcriptionView.state === 'loading' && (
              <div className="flex items-center gap-2 py-3">
                <Spinner size="sm" />
                <span className="text-muted-foreground text-sm">Загружаем транскрипцию…</span>
              </div>
            )}
            {transcriptionView.state === 'error' && (
              <p className="text-danger py-2 text-sm" role="alert">
                {transcriptionView.message}
              </p>
            )}
            {transcriptionView.state === 'ready' && (
              <ScrollShadow className="max-h-48">
                <p className="text-foreground text-sm break-words whitespace-pre-wrap">
                  {transcriptionView.text}
                </p>
              </ScrollShadow>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onPress={() => void openModal()}>
        <FileIcon />
        Файлы
      </Button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-label="Выбрать файл для загрузки"
        onChange={onFileInputChange}
      />

      <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[480px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Файлы</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">{meetingName}</p>
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={isUploading}
                  isPending={isUploading}
                  onPress={() => inputRef.current?.click()}
                >
                  Загрузить файл
                </Button>
              </div>

              {error && (
                <Alert status="danger" className="mb-3">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{error}</Alert.Title>
                  </Alert.Content>
                </Alert>
              )}

              <ScrollShadow className="max-h-80">
                <ul className="flex flex-col gap-2">
                  {isLoading ? (
                    <li className="flex items-center justify-center gap-2 py-8">
                      <Spinner size="sm" />
                      <span className="text-muted-foreground text-sm">Загружаем файлы…</span>
                    </li>
                  ) : isUploading ? (
                    <li className="flex items-center justify-center gap-2 py-8">
                      <Spinner size="sm" />
                      <span className="text-muted-foreground text-sm">Загружаем файл…</span>
                    </li>
                  ) : files.length === 0 && !loadFailed ? (
                    <li className="text-muted-foreground py-8 text-center text-sm">
                      В этой встрече пока нет файлов.
                    </li>
                  ) : (
                    files.map((file) => (
                      <li key={file.id} className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          className="hover:bg-default flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                          title={`Скачать ${file.originalName}`}
                          aria-label={`Скачать ${file.originalName}`}
                          onClick={() => void handleDownload(file)}
                        >
                          <FileIcon />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {file.originalName}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {formatBytes(file.size)} · {formatFileDate(file.uploadedAt)}
                            </span>
                          </span>
                          <Chip size="sm" variant="soft" color="accent">
                            {formatFileType(file.mimeType)}
                          </Chip>
                        </button>
                        {renderTranscriptionControls(file)}
                      </li>
                    ))
                  )}
                </ul>
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
