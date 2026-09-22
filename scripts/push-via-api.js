/**
 * push-via-api.js —— 不依赖 git push 的部署方式
 * ---------------------------------------------------------------
 * 适用场景：网络环境能访问 api.github.com，但 github.com（git push 用到的域）
 * 不可达，或 Schannel 吊销校验失败（CRYPT_E_REVOCATION_OFFLINE）。
 *
 * 原理：用 GitHub Git Data API 把所有文件逐个写成 blob，
 *      组成 tree → 生成 commit → 更新 refs/heads/<branch>，等价于一次推送。
 *
 * 用法：
 *   GITHUB_TOKEN=<PAT> node scripts/push-via-api.js [owner] [repo] [branch]
 * 省略参数时取默认值：hejingfeng9527 / zz-animal-chain / main
 *
 * 注意：请提供勾选过 repo 权限的 Token；脚本不会保存 Token。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNER = process.argv[2] || 'hejingfeng9527';
const REPO = process.argv[3] || 'zz-animal-chain';
const BRANCH = process.argv[4] || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const ROOT = path.resolve(__dirname, '..');

if (!TOKEN) {
  console.error('缺少环境变量 GITHUB_TOKEN');
  process.exit(1);
}

const API = 'https://api.github.com';
const HEADERS = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'zz-animal-chain-pusher'
};

async function req(method, urlPath, body, retry = 3) {
  for (let i = 1; i <= retry; i++) {
    const res = await fetch(API + urlPath, {
      method,
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
    if (res.ok) return json;
    if (i === retry) {
      throw new Error(`${method} ${urlPath} -> HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    await new Promise(r => setTimeout(r, 800 * i));
  }
}

function trackedFiles() {
  const out = execSync('git -c core.quotepath=false ls-files -s', {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  return out.split('\n').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const meta = line.slice(0, tab).trim().split(/\s+/);
    return { mode: meta[0], path: line.slice(tab + 1) };
  });
}

// 单次 tree 请求体上限（GitHub 限制 1MB，留出足够余量）
const MAX_CHUNK_BYTES = 300 * 1024;

// 无 workflow 权限时 GitHub 禁止写入 .github/workflows/（对不该请求返回 404）
const EXCLUDE_PREFIXES = ['.github/workflows/'];

async function buildTree(files, log) {
  let baseTree = null;
  let chunk = [];
  let chunkBytes = 0;
  let flushed = 0;

  const flush = async () => {
    if (!chunk.length) return;
    const body = { tree: chunk };
    if (baseTree) body.base_tree = baseTree;
    const t = await req('POST', `/repos/${OWNER}/${REPO}/git/trees`, body);
    baseTree = t.sha;
    flushed += chunk.length;
    log('  tree ' + flushed + '/' + files.length + ' -> ' + t.sha.slice(0, 7));
    chunk = [];
    chunkBytes = 0;
  };

  for (const f of files) {
    // 注意：tree 条目不支持 encoding=base64（GitHub 会把 base64 串原样存成文件内容），
    // 必须直接给 UTF-8 原文。本仓库全部是文本文件，安全。
    const entry = {
      path: f.repoPath, mode: f.mode, type: 'blob',
      content: fs.readFileSync(f.abs, 'utf8')
    };
    chunk.push(entry);
    chunkBytes += JSON.stringify(entry).length;
    if (chunkBytes >= MAX_CHUNK_BYTES) await flush();
  }
  await flush();
  return baseTree;
}

async function main() {
  const files = [];
  for (const f of trackedFiles()) {
    if (EXCLUDE_PREFIXES.some(p => f.path.startsWith(p))) {
      console.warn('  跳过（无 workflow 权限）: ' + f.path);
      continue;
    }
    const abs = path.join(ROOT, f.path);
    if (!fs.existsSync(abs)) { console.warn('  跳过（磁盘已删除）: ' + f.path); continue; }
    if (fs.statSync(abs).size === 0) { console.warn('  跳过（空文件）: ' + f.path); continue; }
    files.push({ ...f, abs, repoPath: f.path.split(path.sep).join('/') });
  }
  console.log('待推送 ' + files.length + ' 个文件到 ' + OWNER + '/' + REPO + '@' + BRANCH);

  const treeSha = await buildTree(files, console.log);
  console.log('  tree sha: ' + treeSha);

  let parents = [];
  try {
    const ref = await req('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    parents = [ref.object.sha];
    console.log('  已有分支，作为父提交');
  } catch {
    console.log('  空仓库，创建首次提交');
  }

  const commit = await req('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: 'feat: 郑州流浪动物救助链上导航 DApp（线索哈希存证 / 地图点位导航 / 领养全流程上链 / 公益积分）',
    tree: treeSha,
    parents
  });
  console.log('  commit sha: ' + commit.sha);

  try {
    await req('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`, sha: commit.sha
    });
    console.log('  新建分支引用');
  } catch {
    await req('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
    console.log('  更新分支引用');
  }

  console.log(`\n推送完成：https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`);
}

main().catch(e => { console.error('推送失败：' + e.message); process.exit(1); });
