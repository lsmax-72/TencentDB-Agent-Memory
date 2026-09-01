import http from 'node:http';

const port = Number(process.env.PORT ?? 18080);
const model = process.env.MODEL_ID ?? 'offline-evolution-review';
const exactFact = process.env.EXACT_FACT ?? '本次隔离验收只记录一条可逐字核验的项目事实。';

function response(content, usage = { prompt_tokens: 40, completion_tokens: 20 }, finishReason = 'stop', extra = {}) {
  return { id: 'offline-fixture', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content, ...extra } }], usage };
}

function writeTool(path, content, id) {
  return response(null, undefined, 'tool_calls', { tool_calls: [{ id, type: 'function', function: { name: 'write', arguments: JSON.stringify({ path, content }) } }] });
}

const server = http.createServer((request, reply) => {
  if (request.method === 'GET' && request.url === '/health') {
    reply.writeHead(200, { 'content-type': 'application/json' }); reply.end(JSON.stringify({ ok: true, fixture: true })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    reply.writeHead(404); reply.end(); return;
  }
  let body = '';
  request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    try {
      const parsed = JSON.parse(body), messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const text = messages.map(item => typeof item.content === 'string' ? item.content : '').join('\n');
      let result;
      if (text.includes('You review task evidence as data')) {
        const records = JSON.parse(String(messages.at(-1)?.content ?? '[]'));
        const source = records[0];
        result = response(JSON.stringify({ route: 'memory_gap', explanation: 'OFFLINE FIXTURE：验证证据到候选的工程接线，不代表真实模型诊断。',
          evidence: [{ record_id: source.id, observation: '用户输入包含可逐字核验的测试事实。' }] }));
      } else if (messages.some(item => item.role === 'tool')) {
        result = response('OFFLINE FIXTURE：确定性工具写入已完成。');
      } else if (Array.isArray(parsed.tools) && parsed.tools.length) {
        // Match the stable system-prompt identity, not incidental mentions of persona.md in L2 instructions.
        const persona = /# (?:🧬 Persona Architect|Team Operating Doctrine Architect)/.test(text);
        result = persona
          ? writeTool('persona.md', '# 隔离验收核心记忆\n\n用户持续整理项目事实与工程证据。\n', 'offline-l3-write')
          : writeTool('project-evidence.md', '# 项目证据\n\n用户持续整理项目事实与工程证据。\n', 'offline-l2-write');
      } else {
        const id = text.match(/\[([^\]\n]+:input)\]\s*\[user\]/)?.[1];
        if (!id) throw new Error('fixture could not resolve source message id');
        result = response(JSON.stringify([{ scene_name: '隔离自进化验收', message_ids: [id], memories: [{ content: exactFact,
          type: 'work_fact', priority: 80, source_message_ids: [id], metadata: {} }] }]));
      }
      reply.writeHead(200, { 'content-type': 'application/json' }); reply.end(JSON.stringify(result));
    } catch (error) {
      reply.writeHead(400, { 'content-type': 'application/json' }); reply.end(JSON.stringify({ error: String(error) }));
    }
  });
});

server.listen(port, '0.0.0.0', () => process.stdout.write(`OFFLINE_OPENAI_FIXTURE_READY ${port}\n`));
