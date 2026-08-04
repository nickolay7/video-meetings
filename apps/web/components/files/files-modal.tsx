'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Chip, Modal, ScrollShadow, Spinner } from '@heroui/react';
import { formatBytes, formatFileDate, formatFileType } from '../../lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MAX_FILE_SIZE_MB = 20;

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
 * тип, дата), загрузка нового файла и скачивание по клику на элемент списка.
 */
export function FilesModal({ meetingId, meetingName }: FilesModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  function handleUnauthorized() {
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  async function openModal() {
    setIsOpen(true);
    await loadFiles();
  }

  async function loadFiles() {
    const token = getToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!res.ok) {
        setError('Не удалось загрузить список файлов. Попробуйте ещё раз.');
        return;
      }

      const data: MeetingFile[] = await res.json();
      setFiles(data);
    } catch {
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
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
      URL.revokeObjectURL(url);
    } catch {
      setError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    }
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
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

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
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
                  ) : files.length === 0 ? (
                    <li className="text-muted-foreground py-8 text-center text-sm">
                      В этой встрече пока нет файлов.
                    </li>
                  ) : (
                    files.map((file) => (
                      <li key={file.id}>
                        <button
                          type="button"
                          className="hover:bg-default flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                          title={`Скачать ${file.originalName}`}
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
