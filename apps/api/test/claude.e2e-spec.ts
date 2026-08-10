import { Test, TestingModule } from '@nestjs/testing';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeModule } from '../src/claude/claude.module';
import { ClaudeAgentService } from '../src/claude/claude.service';

// SDK — ESM-only и не загружается CJS-рантаймом jest, поэтому мокаем на уровне
// модуля (factory вместо реального импорта). Реальный вызов покрыт отдельным
// Node-тестом test/claude.real.test.mjs (node --test).
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

/** Имитация потока сообщений SDK (AsyncGenerator). */
function messageStream(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
  };
}

describe('ClaudeAgentService (SDK mocked)', () => {
  let claudeAgentService: ClaudeAgentService;

  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const originalTimeoutMs = process.env.CLAUDE_TIMEOUT_MS;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ClaudeModule],
    }).compile();

    claudeAgentService = moduleFixture.get<ClaudeAgentService>(ClaudeAgentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    restoreEnvVar('ANTHROPIC_BASE_URL', originalBaseUrl);
    restoreEnvVar('ANTHROPIC_AUTH_TOKEN', originalAuthToken);
    restoreEnvVar('CLAUDE_TIMEOUT_MS', originalTimeoutMs);
  });

  it('should pass env and permission mode to the SDK and return the result text', async () => {
    process.env.ANTHROPIC_BASE_URL = 'http://gateway.test';
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';

    mockedQuery.mockReturnValue(
      messageStream([
        { type: 'result', subtype: 'success', result: 'hello world' },
      ]) as unknown as Query,
    );

    const text = await claudeAgentService.run('ping');

    expect(text).toBe('hello world');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'ping',
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          env: expect.objectContaining({
            ANTHROPIC_BASE_URL: 'http://gateway.test',
            ANTHROPIC_AUTH_TOKEN: 'test-token',
          }),
        }),
      }),
    );
  });

  it('should throw with the SDK error when the result subtype is an error', async () => {
    mockedQuery.mockReturnValue(
      messageStream([
        { type: 'result', subtype: 'error_during_execution', errors: ['boom'] },
      ]) as unknown as Query,
    );

    await expect(claudeAgentService.run('ping')).rejects.toThrow('Claude query failed: boom');
  });

  it('should throw a timeout error when the query does not finish in time', async () => {
    process.env.CLAUDE_TIMEOUT_MS = '50';

    mockedQuery.mockImplementation(
      (params) =>
        ({
          // Намеренный блокирующий генератор без yield: поток заканчивается только по abort.
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((_resolve, reject) => {
              params.options?.abortController?.signal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            });
          },
        }) as unknown as Query,
    );

    await expect(claudeAgentService.run('ping')).rejects.toThrow(
      'Claude query timed out after 50 ms',
    );
  });

  it('should throw when the query finishes without a result message', async () => {
    mockedQuery.mockReturnValue(messageStream([]) as unknown as Query);

    await expect(claudeAgentService.run('ping')).rejects.toThrow(
      'Claude query finished without a result',
    );
  });
});

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
