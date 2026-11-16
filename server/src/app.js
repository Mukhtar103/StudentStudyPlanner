import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { join } from 'node:path';
import { readConfig } from './config/env.js';
import { createV1 } from './routes/v1.js';
import { handleError, notFound, requestContext } from './middleware/http.js';

const staticOptions = {index:false,dotfiles:'ignore'};

export function createApp({ origins = readConfig().origins, pool = null, sendReset = null, secure = false, trustProxy = 0, webRoot = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(requestContext, helmet({
    strictTransportSecurity:secure,
    contentSecurityPolicy:{directives:{scriptSrc:["'self'"],scriptSrcAttr:["'none'"],objectSrc:["'none'"]}},
  }));
  if (secure && webRoot) app.use((req,res,next)=>{
    if (req.secure || req.path === '/api/v1/health') return next();
    return res.status(426).json({success:false,error:{code:'HTTPS_REQUIRED',message:'Use HTTPS to access Study Planner.'},requestId:req.id});
  });
  app.use(cors({
    origin: (origin, callback) => callback(null, Boolean(origin && origins.includes(origin))),
    credentials: true,
    exposedHeaders: ['X-Request-ID'],
  }), express.json({ limit: '64kb' }));
  app.use('/api/v1', createV1({ origins, pool, sendReset, secure }));
  app.use('/api', notFound);
  if (webRoot) {
    app.use('/assets',express.static(join(webRoot,'assets'),{...staticOptions,immutable:true,maxAge:'1y'}),notFound);
    app.use(express.static(webRoot,staticOptions));
    app.get('/{*path}',(req,res,next)=>{
      if (!req.accepts('html') || req.path.split('/').some(segment=>segment.startsWith('.'))) return next();
      return res.sendFile(join(webRoot,'index.html'),{headers:{'Cache-Control':'no-cache'}});
    });
  }
  app.use(notFound, handleError);
  return app;
}
