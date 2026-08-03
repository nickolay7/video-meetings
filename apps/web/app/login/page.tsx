'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, FieldError, Form, Input, Label, TextField } from '@heroui/react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export default function LoginPage() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        const data: { access_token: string } = await res.json();
        localStorage.setItem('access_token', data.access_token);
        router.push('/');
        return;
      }

      if (res.status === 401) {
        setFormError('Неверный email или пароль');
      } else {
        setFormError('Не удалось войти. Попробуйте ещё раз.');
      }
    } catch {
      setFormError('Ошибка подключения к серверу. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Вход</Card.Title>
          <Card.Description>Войдите в свой аккаунт</Card.Description>
        </Card.Header>

        <Card.Content>
          <Form className="flex flex-col gap-4" validationErrors={fieldErrors} onSubmit={onSubmit}>
            <TextField
              isRequired
              name="email"
              type="email"
              validate={(value) => {
                if (!EMAIL_RE.test(value)) {
                  return 'Введите корректный email';
                }
                return null;
              }}
            >
              <Label>Email</Label>
              <Input placeholder="you@example.com" />
              <FieldError />
            </TextField>

            <TextField isRequired name="password" type="password">
              <Label>Пароль</Label>
              <Input placeholder="••••••••" />
              <FieldError />
            </TextField>

            {formError && (
              <p className="text-danger" role="alert">
                {formError}
              </p>
            )}

            <Button fullWidth variant="primary" type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? 'Входим…' : 'Войти'}
            </Button>
          </Form>
        </Card.Content>
      </Card>

      <p className="text-muted-foreground mt-6 text-sm">
        Нет аккаунта?{' '}
        <Link href="/register" className="text-accent underline">
          Зарегистрироваться
        </Link>
      </p>
    </main>
  );
}
