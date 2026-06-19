import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppWithCrm from './AppWithCrm.tsx';
import { ClientOnboard } from './ClientOnboard.tsx';
import './index.css';

// Клиент-сайд роутинг без react-router:
// /onboard/:token → ClientOnboard
// всё остальное → AppWithCrm (auth gate + role-routing: нутрициолог/клиент)

function Root() {
  const pathname = window.location.pathname;
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

  return <AppWithCrm />;
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
