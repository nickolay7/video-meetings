'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Card, Chip, Spinner } from '@heroui/react';
import { FilesModal } from '../components/files/files-modal';
import { MeetingInsights } from '../components/meeting-insights';
import {
  displayName,
  getAccessToken,
  getInitials,
  ProfileUnauthorizedError,
  useAvatar,
  useProfile,
} from '../hooks/use-profile';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Meeting {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export default function HomePage() {
  const router = useRouter();
  // Профиль и аватар — модульный кэш по токену: после правок на /profile/edit
  // главная показывает обновлённые значения без ручного обновления.
  const { profile, refresh } = useProfile();
  const { avatarUrl, refresh: refreshAvatar } = useAvatar();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const token = getAccessToken();
      if (!token) {
        router.push('/login');
        return;
      }

      try {
        await Promise.all([refresh(), fetchMeetings(token)]);
        if (active) {
          await refreshAvatar();
        }
      } catch (error) {
        if (error instanceof ProfileUnauthorizedError) {
          localStorage.removeItem('access_token');
          router.push('/login');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [router, refresh, refreshAvatar]);

  async function fetchMeetings(token: string) {
    try {
      const res = await fetch(`${API_URL}/meetings`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        localStorage.removeItem('access_token');
        router.push('/login');
        return;
      }

      if (res.ok) {
        const data: Meeting[] = await res.json();
        // Sort by createdAt descending and take last 3
        const sorted = data.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setMeetings(sorted.slice(0, 3));
      }
    } catch (error) {
      console.error('Failed to fetch meetings:', error);
    }
  }

  async function handleCreateMeeting() {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/meetings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Встреча ${new Date().toLocaleString('ru-RU')}`,
          description: 'Создана автоматически',
        }),
      });

      if (res.ok) {
        // Refresh meetings list
        fetchMeetings(token);
      } else if (res.status === 401) {
        localStorage.removeItem('access_token');
        router.push('/login');
      }
    } catch (error) {
      console.error('Failed to create meeting:', error);
    } finally {
      setIsCreating(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  if (isLoading) {
    return (
      <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center">
        <Spinner size="lg" />
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center gap-8 px-6 py-12">
      {/* Header: аватар и имя пользователя — ссылка на /profile */}
      <header className="flex w-full max-w-5xl items-center justify-between">
        <Link
          href="/profile"
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <Avatar color="accent">
            {avatarUrl ? (
              <Avatar.Image src={avatarUrl} alt="Фото профиля" />
            ) : (
              <Avatar.Fallback>{profile ? getInitials(profile) : 'VM'}</Avatar.Fallback>
            )}
          </Avatar>
          <div>
            <h1 className="text-xl font-bold">Video Meetings</h1>
            <p className="text-muted-foreground text-sm">
              {profile ? `Привет, ${displayName(profile)}` : 'Платформа видеоконференций'}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <Badge color="success" variant="primary">
            Online
          </Badge>
          <Button variant="ghost" size="sm" onPress={handleLogout}>
            Выйти
          </Button>
        </div>
      </header>

      {/* Stats */}
      <section className="w-full max-w-5xl">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-sm">Всего встреч</p>
              <p className="text-3xl font-bold">{meetings.length}</p>
            </div>
            <Button variant="primary" onPress={handleCreateMeeting} isDisabled={isCreating}>
              {isCreating ? 'Создаём…' : 'Создать встречу'}
            </Button>
          </div>
        </Card>
      </section>

      {/* Recent meetings */}
      <section className="w-full max-w-5xl">
        <h2 className="mb-4 text-xl font-semibold">Последние встречи</h2>
        {meetings.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-muted-foreground">У вас пока нет встреч. Создайте первую!</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {meetings.map((meeting) => (
              <Card key={meeting.id} className="p-4">
                <Card.Header className="p-0 pb-2">
                  <Card.Title className="text-base">{meeting.name}</Card.Title>
                </Card.Header>
                <Card.Content className="p-0">
                  {meeting.description && (
                    <p className="text-muted-foreground mb-2 text-sm">{meeting.description}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <Chip size="sm" variant="soft" color="accent">
                      {new Date(meeting.createdAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Chip>
                    <FilesModal meetingId={meeting.id} meetingName={meeting.name} />
                  </div>
                  <MeetingInsights meetingId={meeting.id} />
                </Card.Content>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
