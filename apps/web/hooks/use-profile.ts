'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Profile {
  id: string;
  email: string;
  name?: string | null;
}

/** Ответ с 401 означает «токен протух» — вызывающий делает logout. */
export class ProfileUnauthorizedError extends Error {}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('access_token');
}

export async function fetchProfile(token: string): Promise<Profile> {
  const res = await fetch(`${API_URL}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new ProfileUnauthorizedError();
  }
  if (!res.ok) {
    throw new Error(`Failed to load profile: ${res.status}`);
  }
  return (await res.json()) as Profile;
}

/** Отображаемое имя: имя пользователя, а при его отсутствии — email (fallback из PRD). */
export function displayName(profile: Profile): string {
  return profile.name?.trim() ? profile.name : profile.email;
}

/** Инициалы для аватара-заглушки: первая буква имени (или email), верхним регистром. */
export function getInitials(profile: Profile): string {
  const source = profile.name?.trim() || profile.email;
  return source.slice(0, 1).toUpperCase();
}

// Модульный кэш: профиль переживает клиентскую навигацию без повторного запроса.
let profileCache: Profile | null = null;

/** Профиль текущего пользователя с модульным кэшем (см. ресерч §6.2). */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(profileCache);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (): Promise<Profile | null> => {
    const token = getAccessToken();
    if (!token) {
      profileCache = null;
      setProfile(null);
      return null;
    }
    setIsLoading(true);
    try {
      const data = await fetchProfile(token);
      profileCache = data;
      setProfile(data);
      return data;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Синхронное обновление из ответа API (PATCH /profile, загрузка аватара). */
  const update = useCallback((data: Profile) => {
    profileCache = data;
    setProfile(data);
  }, []);

  return { profile, isLoading, refresh, update };
}

/**
 * Загрузка аватара через fetch + blob + URL.createObjectURL:
 * `<img src={API_URL}/profile/avatar>` не отправил бы Authorization (см. ресерч §6.1).
 * Возвращает null, если аватар не загружен (404) или сервер недоступен.
 */
async function fetchAvatarBlob(token: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/profile/avatar`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new ProfileUnauthorizedError();
  }
  if (!res.ok) {
    return null;
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Object-URL аватара с корректной отменой предыдущего URL и очисткой при размонтировании. */
export function useAvatar() {
  const [avatarUrl, setAvatarUrlState] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const setAvatarUrl = useCallback((url: string | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = url;
    setAvatarUrlState(url);
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    const token = getAccessToken();
    if (!token) {
      setAvatarUrl(null);
      return null;
    }
    const url = await fetchAvatarBlob(token);
    setAvatarUrl(url);
    return url;
  }, [setAvatarUrl]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return { avatarUrl, refresh, setAvatarUrl };
}
