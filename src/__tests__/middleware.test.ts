import express from 'express';
import request from 'supertest';

import { apiCache } from '../middleware';

describe('apiCache middleware', () => {
  test('caches GET responses', async () => {
    const app = express();
    app.use(express.json());

    let count = 0;
    app.use(
      apiCache({
        ttl: 5,
        methods: ['GET', 'POST'],
        useMemory: true,
        useRedis: false,
      }),
    );

    app.get('/users', (req, res) => {
      count++;
      res.json({ count });
    });

    const r1 = await request(app).get('/users');
    const r2 = await request(app).get('/users');

    expect(r1.body.count).toBe(1);
    expect(r2.body.count).toBe(1);
  });

  test('stale-while-revalidate serves stale and refreshes', async () => {
    const app = express();
    app.use(express.json());

    let count = 0;
    app.use(
      apiCache({ ttl: 0, staleWhileRevalidate: true, useMemory: true, useRedis: false }),
    );

    app.get('/data', (req, res) => {
      count++;
      res.json({ count });
    });

    await request(app).get('/data'); // prime cache count=1
    const r2 = await request(app).get('/data');
    expect(r2.body.count).toBe(1); // stale served

    await new Promise((r) => setTimeout(r, 50));

    const r3 = await request(app).get('/data');
    expect(r3.body.count).toBe(2);
  });

  test('invalidates on POST when enabled', async () => {
    const app = express();
    app.use(express.json());

    let list = [1];
    app.use(
      apiCache({ ttl: 30, invalidateOnWrite: true, useMemory: true, useRedis: false }),
    );

    app.get('/list', (req, res) => {
      res.json({ list });
    });

    app.post('/list', (req, res) => {
      list.push(req.body.value);
      res.json({ ok: true });
    });

    const r1 = await request(app).get('/list');
    expect(r1.body.list).toEqual([1]);

    await request(app).post('/list').send({ value: 2 });

    const r2 = await request(app).get('/list');
    expect(r2.body.list).toEqual([1, 2]);
  });

  test('can cache POST when allowed', async () => {
    const app = express();
    app.use(express.json());

    app.use(
      apiCache({
        ttl: 30,
        useMemory: true,
        useRedis: false,
        cachePostPredicate: (req) => req.path === '/search',
      }),
    );

    let calls = 0;
    app.post('/search', (req, res) => {
      calls++;
      res.json({ q: req.body.q, calls });
    });

    const r1 = await request(app).post('/search').send({ q: 'a' });
    const r2 = await request(app).post('/search').send({ q: 'a' });
    expect(r1.body.calls).toBe(1);
    expect(r2.body.calls).toBe(1);
  });
});
