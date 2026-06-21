import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppWithCrm from './AppWithCrm.tsx';
import ClientApp from './ClientApp.tsx';
import { ClientOnboard } from './ClientOnboard.tsx';
import './index.css';

// Клиент-сайд роутинг без react-router. Сервисы разделены по доменам:
// cms.nutria.one      → AppWithCrm (логин/регистрация нутрициолога + CRM-кабинет)
// app.nutria.one (и всё остальное) → ClientApp напрямую (личный дневник питания)
// /onboard/:token (на любом домене) → ClientOnboard (приглашение от нутрициолога)

const CRM_HOSTNAME = 'cms.nutria.one';

function Root() {
  const pathname = window.location.pathname;
  const hostname = window.location.hostname;
  const onboardMatch = pathname.match(/^\/onboard\/([^/]+)$/);

  if (onboardMatch) {
    const token = onboardMatch[1];
    return (
      <ClientOnboard
        token={token}
        onComplete={(_user, _jwtToken) => {
          // После успешного онбординга → отправляем на главную (дневник питания)
          window.location.href = '/';
        }}
      />
    );
  }

  if (hostname === CRM_HOSTNAME) {
    return <AppWithCrm />;
  }

  // app.nutria.one и любой другой домен — личный дневник питания, без CRM-гейта
  return <ClientApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}
