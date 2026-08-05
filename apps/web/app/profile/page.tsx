'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Card, Spinner } from '@heroui/react';
import {
  displayName,
  getAccessToken,
  getInitials,
  ProfileUnauthorizedError,
  useAvatar,
  useProfile,
} from '../../hooks/use-profile';

export default function ProfilePage() {
  const router = useRouter();
  const { profile, isLoading, refresh } = useProfile();
  const { avatarUrl, refresh: refreshAvatar } = useAvatar();

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

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
        >
          ← На главную
        </Link>

        {isLoading && !profile ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : profile ? (
          <Card>
            <Card.Header className="flex flex-col items-center gap-4 pb-4 text-center">
              <Avatar size="lg" color="accent">
                {avatarUrl ? (
                  <Avatar.Image src={avatarUrl} alt="Фото профиля" />
                ) : (
                  <Avatar.Fallback>{getInitials(profile)}</Avatar.Fallback>
                )}
              </Avatar>
              <div>
                <Card.Title className="text-2xl">{displayName(profile)}</Card.Title>
                <Card.Description className="text-muted-foreground">
                  {profile.email}
                </Card.Description>
              </div>
            </Card.Header>
            <Card.Content className="flex flex-col gap-2">
              <Button fullWidth variant="primary" onPress={() => router.push('/profile/edit')}>
                Редактировать профиль
              </Button>
              <Button fullWidth variant="ghost" onPress={() => router.push('/')}>
                На главную
              </Button>
            </Card.Content>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
