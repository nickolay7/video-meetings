'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Avatar,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
} from '@heroui/react';
import {
  displayName,
  getAccessToken,
  getInitials,
  Profile,
  ProfileUnauthorizedError,
  useAvatar,
  useProfile,
} from '../../../hooks/use-profile';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

export default function ProfileEditPage() {
  const router = useRouter();
  const { profile, isLoading, refresh, update } = useProfile();
  const { avatarUrl, refresh: refreshAvatar, setPreviewUrl, resetPreview } = useAvatar();

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const token = getAccessToken();
      if (!token) {
        router.push('/login');
        return;
      }
      try {
        await refresh();
        if (active) {
          await refreshAvatar();
        }
      } catch (error) {
        if (error instanceof ProfileUnauthorizedError) {
          localStorage.removeItem('access_token');
          router.push('/login');
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [refresh, refreshAvatar, router]);

  function handleUnauthorized() {
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  async function handleNameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get('name') ?? '').trim();

    setNameError(null);
    setNameSuccess(null);
    setIsSavingName(true);
    try {
      const res = await fetch(`${API_URL}/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!res.ok) {
        setNameError('Не удалось сохранить имя. Попробуйте ещё раз.');
        return;
      }

      const data: Profile = await res.json();
      update(data);
      setNameSuccess('Имя сохранено');
    } catch {
      setNameError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    } finally {
      setIsSavingName(false);
    }
  }

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    // Быстрые клиентские проверки; сервер (magic-bytes + лимит) остаётся источником истины.
    if (file.type && !file.type.startsWith('image/')) {
      setAvatarError('Файл должен быть изображением');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError('Файл слишком большой. Максимальный размер — 5 МБ.');
      return;
    }

    setAvatarError(null);
    // Превью выбранного файла; серверный аватар сохраняется в хуке для отката.
    setPreviewUrl(URL.createObjectURL(file));

    const token = getAccessToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch(`${API_URL}/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      // Ошибка: возвращаем прежний аватар без round-trip к сети.
      if (res.status === 400) {
        setAvatarError('Файл не является изображением. Загрузите картинку.');
        resetPreview();
        return;
      }
      if (res.status === 413) {
        setAvatarError('Файл слишком большой. Максимальный размер — 5 МБ.');
        resetPreview();
        return;
      }
      if (!res.ok) {
        setAvatarError('Не удалось загрузить аватар. Попробуйте ещё раз.');
        resetPreview();
        return;
      }

      const data: Profile = await res.json();
      update(data);
      try {
        await refreshAvatar();
      } catch {
        // Загрузка прошла успешно — предпросмотр уже показывает новый файл.
      }
    } catch {
      setAvatarError('Ошибка подключения к серверу. Попробуйте ещё раз.');
      resetPreview();
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const token = getAccessToken();
    if (!token) {
      handleUnauthorized();
      return;
    }

    const formData = new FormData(form);
    const oldPassword = String(formData.get('oldPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');

    setPasswordError(null);
    setPasswordSuccess(null);
    setIsSavingPassword(true);
    try {
      const res = await fetch(`${API_URL}/profile/password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      if (res.status === 401) {
        handleUnauthorized();
        return;
      }

      if (!res.ok) {
        // 400 при неверном старом пароле; форма не сбрасывается, пока ошибка не устранена.
        // Различаем по message из тела ответа: сервер отдаёт 400 и при нарушении DTO.
        let message = 'Не удалось изменить пароль. Попробуйте ещё раз.';
        if (res.status === 400) {
          const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
          message =
            data?.message === 'Old password is incorrect'
              ? 'Неверный текущий пароль'
              : 'Проверьте корректность введённых данных';
        }
        setPasswordError(message);
        return;
      }

      setPasswordSuccess('Пароль изменён');
      form.reset();
    } catch {
      setPasswordError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/profile"
          className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
        >
          ← Профиль
        </Link>

        {isLoading && !profile ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : !isLoading && !profile ? (
          <p className="text-muted-foreground py-16 text-center text-sm" role="alert">
            Не удалось загрузить профиль. Попробуйте ещё раз.
          </p>
        ) : profile ? (
          <div className="flex flex-col gap-6">
            {/* Аватар */}
            <Card>
              <Card.Header>
                <Card.Title>Аватар</Card.Title>
                <Card.Description>Фотография, изображение до 5 МБ</Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col items-center gap-4">
                <Avatar size="lg" color="accent">
                  {avatarUrl ? (
                    <Avatar.Image src={avatarUrl} alt="Фото профиля" />
                  ) : (
                    <Avatar.Fallback>{getInitials(profile)}</Avatar.Fallback>
                  )}
                </Avatar>
                <p className="text-muted-foreground text-sm">{displayName(profile)}</p>

                <Button
                  variant="secondary"
                  isDisabled={isUploadingAvatar}
                  isPending={isUploadingAvatar}
                  onPress={() => avatarInputRef.current?.click()}
                >
                  {isUploadingAvatar
                    ? 'Загружаем…'
                    : avatarUrl
                      ? 'Заменить аватар'
                      : 'Загрузить аватар'}
                </Button>

                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Выбрать изображение для аватара"
                  onChange={(event) => void handleAvatarChange(event)}
                />

                {avatarError && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{avatarError}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                )}
              </Card.Content>
            </Card>

            {/* Имя */}
            <Card>
              <Card.Header>
                <Card.Title>Имя</Card.Title>
                <Card.Description>
                  Если оставить поле пустым, будет отображаться email
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <Form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
                  <TextField key={profile.id} name="name" defaultValue={profile.name ?? ''}>
                    <Label>Имя</Label>
                    <Input placeholder="Как вас зовут?" />
                    <FieldError />
                  </TextField>

                  {nameError && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{nameError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  {nameSuccess && (
                    <Alert status="success">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{nameSuccess}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}

                  <Button
                    fullWidth
                    variant="primary"
                    type="submit"
                    isDisabled={isSavingName}
                    isPending={isSavingName}
                  >
                    {isSavingName ? 'Сохраняем…' : 'Сохранить имя'}
                  </Button>
                </Form>
              </Card.Content>
            </Card>

            {/* Смена пароля */}
            <Card>
              <Card.Header>
                <Card.Title>Смена пароля</Card.Title>
                <Card.Description>Новый пароль — не короче 8 символов</Card.Description>
              </Card.Header>
              <Card.Content>
                <Form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
                  <TextField
                    isRequired
                    name="oldPassword"
                    type="password"
                    autoComplete="current-password"
                  >
                    <Label>Текущий пароль</Label>
                    <Input placeholder="••••••••" />
                    <FieldError />
                  </TextField>

                  <TextField
                    isRequired
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    validate={(value) =>
                      value.length < 8 ? 'Пароль должен быть не короче 8 символов' : null
                    }
                  >
                    <Label>Новый пароль</Label>
                    <Input placeholder="Минимум 8 символов" />
                    <FieldError />
                  </TextField>

                  {passwordError && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{passwordError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  {passwordSuccess && (
                    <Alert status="success">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{passwordSuccess}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}

                  <Button
                    fullWidth
                    variant="primary"
                    type="submit"
                    isDisabled={isSavingPassword}
                    isPending={isSavingPassword}
                  >
                    {isSavingPassword ? 'Меняем…' : 'Сменить пароль'}
                  </Button>
                </Form>
              </Card.Content>
            </Card>
          </div>
        ) : null}
      </div>
    </main>
  );
}
