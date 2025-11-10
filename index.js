const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// 設定ファイルのパス
const CONFIG_PATH = path.join(__dirname, 'config.json');
const HISTORY_PATH = path.join(__dirname, 'history.json');

// デフォルト設定
const DEFAULT_CONFIG = {
  token: 'YOUR_BOT_TOKEN_HERE',
  targetRoleId: 'YOUR_TARGET_ROLE_ID_HERE',
  prefix: '!eta',
  minTimeout: 10,
  maxTimeout: 90,
  cooldownSeconds: 60,
  webPort: 3000,
  webPassword: 'admin123',
  enabledGuilds: []
};

// グローバル変数
let config = {};
let history = { timeouts: [], statistics: {} };
let cooldowns = new Map();

// Discord クライアント
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Express サーバー
const app = express();
app.use(express.json());
app.use(express.static('public'));

// 設定の読み込み
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch (error) {
    config = { ...DEFAULT_CONFIG };
    await saveConfig();
  }
}

// 設定の保存
async function saveConfig() {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// 履歴の読み込み
async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_PATH, 'utf8');
    history = JSON.parse(data);
  } catch (error) {
    history = { timeouts: [], statistics: {} };
    await saveHistory();
  }
}

// 履歴の保存
async function saveHistory() {
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// 統計情報の更新
function updateStatistics(guildId, executorId, targetId) {
  if (!history.statistics[guildId]) {
    history.statistics[guildId] = {};
  }
  if (!history.statistics[guildId][executorId]) {
    history.statistics[guildId][executorId] = { executed: 0, targets: {} };
  }
  history.statistics[guildId][executorId].executed++;
  
  if (!history.statistics[guildId][executorId].targets[targetId]) {
    history.statistics[guildId][executorId].targets[targetId] = 0;
  }
  history.statistics[guildId][executorId].targets[targetId]++;
}

// クールダウンチェック
function checkCooldown(userId, guildId) {
  const key = `${guildId}-${userId}`;
  if (cooldowns.has(key)) {
    const expirationTime = cooldowns.get(key);
    if (Date.now() < expirationTime) {
      const timeLeft = Math.ceil((expirationTime - Date.now()) / 1000);
      return timeLeft;
    }
  }
  return 0;
}

// クールダウン設定
function setCooldown(userId, guildId) {
  const key = `${guildId}-${userId}`;
  cooldowns.set(key, Date.now() + config.cooldownSeconds * 1000);
}

// Bot準備完了
client.once('ready', () => {
  console.log(`✅ ログイン成功: ${client.user.tag}`);
  console.log(`🌐 Web管理画面: http://localhost:${config.webPort}`);
  client.user.setActivity('!eta help でヘルプ表示', { type: 'PLAYING' });
});

// メッセージ処理
client.on('messageCreate', async (message) => {
  // BOT自身のメッセージは無視
  if (message.author.bot) return;
  
  // DMは無視
  if (!message.guild) return;
  
  // プレフィックスチェック
  if (!message.content.startsWith(config.prefix)) return;
  
  const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const command = args[0].toLowerCase();
  
  // ヘルプコマンド
  if (command === 'help' || command === 'ヘルプ') {
    const helpEmbed = {
      color: 0x5865F2,
      title: '📚 ETA Bot ヘルプ',
      description: 'タイムアウト管理BOTのコマンド一覧',
      fields: [
        {
          name: `${config.prefix} @ユーザー`,
          value: `指定したユーザーをランダムな時間（${config.minTimeout}～${config.maxTimeout}秒）でタイムアウトします。`,
          inline: false
        },
        {
          name: `${config.prefix} stats`,
          value: '自分のタイムアウト実行統計を表示します。',
          inline: false
        },
        {
          name: `${config.prefix} ranking`,
          value: 'サーバー内のタイムアウト実行ランキングを表示します。',
          inline: false
        },
        {
          name: `${config.prefix} history`,
          value: '最近のタイムアウト履歴を表示します。',
          inline: false
        },
        {
          name: `${config.prefix} info`,
          value: 'BOTの設定情報を表示します。',
          inline: false
        }
      ],
      footer: { text: '💡 Web管理画面でさらに詳細な設定が可能です' },
      timestamp: new Date()
    };
    
    return message.reply({ embeds: [helpEmbed] });
  }
  
  // 統計コマンド
  if (command === 'stats' || command === '統計') {
    const guildStats = history.statistics[message.guild.id];
    const userStats = guildStats?.[message.author.id];
    
    if (!userStats) {
      return message.reply('📊 まだタイムアウトを実行していません。');
    }
    
    const topTargets = Object.entries(userStats.targets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, count]) => `<@${userId}>: ${count}回`)
      .join('\n');
    
    const statsEmbed = {
      color: 0x57F287,
      title: '📊 あなたの統計',
      fields: [
        { name: '総実行回数', value: `${userStats.executed}回`, inline: true },
        { name: 'ターゲット数', value: `${Object.keys(userStats.targets).length}人`, inline: true },
        { name: 'よくタイムアウトした人', value: topTargets || 'データなし', inline: false }
      ],
      timestamp: new Date()
    };
    
    return message.reply({ embeds: [statsEmbed] });
  }
  
  // ランキングコマンド
  if (command === 'ranking' || command === 'ランキング') {
    const guildStats = history.statistics[message.guild.id];
    
    if (!guildStats || Object.keys(guildStats).length === 0) {
      return message.reply('📊 まだランキングデータがありません。');
    }
    
    const ranking = Object.entries(guildStats)
      .map(([userId, data]) => ({ userId, executed: data.executed }))
      .sort((a, b) => b.executed - a.executed)
      .slice(0, 10)
      .map((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} <@${entry.userId}>: ${entry.executed}回`;
      })
      .join('\n');
    
    const rankingEmbed = {
      color: 0xFEE75C,
      title: '🏆 タイムアウト実行ランキング',
      description: ranking,
      timestamp: new Date()
    };
    
    return message.reply({ embeds: [rankingEmbed] });
  }
  
  // 履歴コマンド
  if (command === 'history' || command === '履歴') {
    const recentHistory = history.timeouts
      .filter(h => h.guildId === message.guild.id)
      .slice(-10)
      .reverse()
      .map(h => {
        const date = new Date(h.timestamp);
        return `\`${date.toLocaleString('ja-JP')}\` <@${h.executorId}> → <@${h.targetId}> (${h.duration}秒)`;
      })
      .join('\n');
    
    if (!recentHistory) {
      return message.reply('📜 履歴がありません。');
    }
    
    const historyEmbed = {
      color: 0xEB459E,
      title: '📜 最近のタイムアウト履歴',
      description: recentHistory,
      timestamp: new Date()
    };
    
    return message.reply({ embeds: [historyEmbed] });
  }
  
  // 情報コマンド
  if (command === 'info' || command === '情報') {
    const infoEmbed = {
      color: 0x5865F2,
      title: 'ℹ️ BOT設定情報',
      fields: [
        { name: 'タイムアウト時間範囲', value: `${config.minTimeout}～${config.maxTimeout}秒`, inline: true },
        { name: 'クールダウン', value: `${config.cooldownSeconds}秒`, inline: true },
        { name: 'ターゲットロールID', value: config.targetRoleId, inline: false },
        { name: '総タイムアウト回数', value: `${history.timeouts.length}回`, inline: true }
      ],
      timestamp: new Date()
    };
    
    return message.reply({ embeds: [infoEmbed] });
  }
  
  // メインのタイムアウトコマンド
  if (args.length < 2 || !message.mentions.users.size) {
    return message.reply('❌ 使い方: `!eta @ユーザー`');
  }
  
  const targetUser = message.mentions.users.first();
  const targetMember = message.guild.members.cache.get(targetUser.id);
  
  if (!targetMember) {
    return message.reply('❌ ユーザーが見つかりませんでした。');
  }
  
  // 自分自身をターゲットにできない
  if (targetUser.id === message.author.id) {
    return message.reply('❌ 自分自身をタイムアウトすることはできません。');
  }
  
  // BOTをターゲットにできない
  if (targetUser.bot) {
    return message.reply('❌ BOTをタイムアウトすることはできません。');
  }
  
  // ターゲットロールチェック
  if (!targetMember.roles.cache.has(config.targetRoleId)) {
    return message.reply('❌ このユーザーはターゲットロールを持っていません。');
  }
  
  // 実行者がターゲットロールを持っていないかチェック
  const executorMember = message.guild.members.cache.get(message.author.id);
  if (executorMember.roles.cache.has(config.targetRoleId)) {
    return message.reply('❌ ターゲットロールを持つユーザーはこのコマンドを実行できません。');
  }
  
  // クールダウンチェック
  const cooldownLeft = checkCooldown(message.author.id, message.guild.id);
  if (cooldownLeft > 0) {
    return message.reply(`⏳ クールダウン中です。あと${cooldownLeft}秒お待ちください。`);
  }
  
  // 権限チェック
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return message.reply('❌ BOTにタイムアウト権限がありません。');
  }
  
  // ランダムな時間を生成
  const duration = Math.floor(Math.random() * (config.maxTimeout - config.minTimeout + 1)) + config.minTimeout;
  
  try {
    // タイムアウト実行
    await targetMember.timeout(duration * 1000, `ETAコマンドによる自動タイムアウト (実行者: ${message.author.tag})`);
    
    // クールダウン設定
    setCooldown(message.author.id, message.guild.id);
    
    // 履歴に追加
    history.timeouts.push({
      guildId: message.guild.id,
      executorId: message.author.id,
      targetId: targetUser.id,
      duration: duration,
      timestamp: new Date().toISOString()
    });
    
    // 統計更新
    updateStatistics(message.guild.id, message.author.id, targetUser.id);
    
    // 履歴保存
    await saveHistory();
    
    const successEmbed = {
      color: 0x57F287,
      title: '✅ タイムアウト成功',
      fields: [
        { name: 'ターゲット', value: `<@${targetUser.id}>`, inline: true },
        { name: '時間', value: `${duration}秒`, inline: true },
        { name: '実行者', value: `<@${message.author.id}>`, inline: true }
      ],
      footer: { text: `次回実行まで ${config.cooldownSeconds}秒のクールダウン` },
      timestamp: new Date()
    };
    
    message.reply({ embeds: [successEmbed] });
    
  } catch (error) {
    console.error('タイムアウトエラー:', error);
    message.reply('❌ タイムアウトの実行に失敗しました。権限を確認してください。');
  }
});

// Web管理画面のルート
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 設定取得API
app.get('/api/config', (req, res) => {
  // トークンは隠す
  const safeConfig = { ...config, token: '***隠されています***' };
  res.json(safeConfig);
});

// 設定更新API
app.post('/api/config', async (req, res) => {
  const { password, ...newConfig } = req.body;
  
  if (password !== config.webPassword) {
    return res.status(401).json({ error: '認証失敗' });
  }
  
  // トークンが変更されていない場合は既存のものを使用
  if (newConfig.token === '***隠されています***') {
    newConfig.token = config.token;
  }
  
  config = { ...config, ...newConfig };
  await saveConfig();
  
  res.json({ success: true, message: '設定を更新しました' });
});

// 統計取得API
app.get('/api/statistics', (req, res) => {
  res.json(history);
});

// 統計リセットAPI
app.post('/api/statistics/reset', async (req, res) => {
  const { password } = req.body;
  
  if (password !== config.webPassword) {
    return res.status(401).json({ error: '認証失敗' });
  }
  
  history = { timeouts: [], statistics: {} };
  await saveHistory();
  
  res.json({ success: true, message: '統計をリセットしました' });
});

// サーバー起動
async function start() {
  await loadConfig();
  await loadHistory();
  
  // Web サーバー起動
  app.listen(config.webPort, () => {
    console.log(`🌐 Web管理画面が起動しました: http://localhost:${config.webPort}`);
  });
  
  // Discord BOT起動
  try {
    await client.login(config.token);
  } catch (error) {
    console.error('❌ BOTのログインに失敗しました:', error);
    console.log('config.jsonにDiscord BOTのトークンを設定してください。');
  }
}

start();
