'use client';

import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Switch,
  Tabs,
  TextField,
} from '@heroui/react';

export default function Home() {
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center gap-12 px-6 py-12">
      {/* Header */}
      <header className="flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar color="accent">VM</Avatar>
          <div>
            <h1 className="text-xl font-bold">Video Meetings</h1>
            <p className="text-muted-foreground text-sm">Платформа видеоконференций</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge color="success" variant="primary">
            Online
          </Badge>
          <Button variant="ghost" size="sm" onPress={() => alert('Вход в аккаунт')}>
            Войти
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="w-full max-w-5xl text-center">
        <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Видеовстречи без сложностей
        </h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-lg">
          Создайте конференцию за секунды или присоединитесь к существующей по коду.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" variant="primary" onPress={() => alert('Создаём новую встречу…')}>
            Создать встречу
          </Button>
          <Button size="lg" variant="secondary" onPress={() => alert('Подробнее о сервисе')}>
            Узнать больше
          </Button>
        </div>
      </section>

      {/* Meeting card */}
      <Card className="w-full max-w-xl">
        <Card.Header>
          <Card.Title>Начать встречу</Card.Title>
          <Card.Description>Создайте комнату или войдите по коду</Card.Description>
        </Card.Header>
        <Card.Content>
          <Tabs defaultSelectedKey="join">
            <Tabs.List>
              <Tabs.Tab id="join">Присоединиться</Tabs.Tab>
              <Tabs.Tab id="create">Создать</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel id="join" className="mt-4 flex flex-col gap-4">
              <TextField className="flex flex-col gap-1.5">
                <Label>Код встречи</Label>
                <Input placeholder="000-000-000" />
              </TextField>
              <TextField className="flex flex-col gap-1.5">
                <Label>Ваше имя</Label>
                <Input placeholder="Иван Иванов" />
              </TextField>
              <Button fullWidth variant="primary" onPress={() => alert('Подключаемся к встрече…')}>
                Войти в встречу
              </Button>
            </Tabs.Panel>

            <Tabs.Panel id="create" className="mt-4 flex flex-col gap-4">
              <TextField className="flex flex-col gap-1.5">
                <Label>Название встречи</Label>
                <Input placeholder="Ежедневный стендап" />
              </TextField>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Включить камеру</span>
                <Switch isSelected={isCameraOn} onChange={setIsCameraOn} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Включить микрофон</span>
                <Switch isSelected={isMicOn} onChange={setIsMicOn} />
              </div>
              <Button
                fullWidth
                variant="secondary"
                onPress={() => alert('Создаём комнату и копируем ссылку…')}
              >
                Создать и скопировать ссылку
              </Button>
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      </Card>

      {/* Features */}
      <section className="w-full max-w-5xl">
        <h3 className="mb-6 text-2xl font-semibold">Возможности</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <Card.Header>
                <Card.Title>{feature.title}</Card.Title>
                <Card.Description>{feature.description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <Chip color={feature.chipColor} variant="soft">
                  {feature.chip}
                </Chip>
              </Card.Content>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

const features = [
  {
    title: 'HD видео',
    description: 'Кристально чистое видео и аудио для команд любого размера.',
    chip: 'Готово',
    chipColor: 'success' as const,
  },
  {
    title: 'Демонстрация экрана',
    description: 'Покажите экран или отдельное окно одной кнопкой.',
    chip: 'Быстро',
    chipColor: 'accent' as const,
  },
  {
    title: 'Безопасность',
    description: 'Комнаты с доступом по коду и настройками модератора.',
    chip: 'Защищено',
    chipColor: 'warning' as const,
  },
];
