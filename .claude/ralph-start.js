const { execSync } = require('child_process');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('.claude/ralph-config.json', 'utf8'));

// Сбрасываем счётчик итераций
fs.writeFileSync('.claude/ralph.iterations.json', JSON.stringify({ count: 0, phaseIndex: 0 }));

// Запускаем первую итерацию
const prompt = config.prompt
  .replace('{milestone}', config.phases[0].milestone)
  .replace('{branch}', config.phases[0].branch);
console.log(`🚀 Запускаем Ralph для milestone: ${config.phases[0].milestone}`);

try {
  execSync(`fcc-claude -p "${prompt}" --max-turns ${config.maxTurns}`, { stdio: 'inherit' });
} catch {
  // Ненулевой код выхода (например, достигнут --max-turns) — нормальный конец итерации, не краш
  console.log('⚠️ Итерация завершилась с ненулевым кодом (вероятно, лимит ходов). Продолжаем.');
}
