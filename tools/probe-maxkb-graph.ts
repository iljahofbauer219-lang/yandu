#!/usr/bin/env node
import { promises as fsp } from 'node:fs'

async function main() {
  const envRaw = await fsp.readFile('.env.local', 'utf8')
  const env = Object.fromEntries(envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  const T = (await (await fetch(env.MAXKB_BASE_URL + '/admin/api/user/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'zq2525063' }) })).json()).data.token
  process.env.MAXKB_ADMIN_TOKEN = T
  console.log('token len:', T.length, 'MAXKB_ADMIN_TOKEN set')

  const { MaxkbKnowledgeService } = await import('../src/main/services/MaxkbKnowledgeService.ts')
  const svc = new MaxkbKnowledgeService()
  try {
    const list = await svc.list()
    console.log('list agents:', list.agents.length, 'customs:', list.customs.length)
    for (const c of list.customs) console.log('  KB:', c.name, 'docs:', c.documentCount)
    const docs = await svc.listDocs(list.customs[0].id)
    console.log('docs count:', docs.docs.length)
    if (docs.docs.length) console.log('first doc:', JSON.stringify(docs.docs[0]))
    const stats = await svc.graphStats()
    console.log('graph stats:', JSON.stringify(stats))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
}

main().catch(e => console.error('FATAL:', e))
