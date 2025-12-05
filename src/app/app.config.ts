// app.config.ts
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideFirebaseApp, initializeApp} from '@angular/fire/app';
import {provideAuth, getAuth} from '@angular/fire/auth';
import {provideDatabase, getDatabase} from '@angular/fire/database';
import {provideFirestore, getFirestore} from '@angular/fire/firestore';

import {routes} from './app.routes';
import {environment} from '../environments/environment';
import {provideHttpClient} from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideDatabase(() => getDatabase()),      // Para sesiones (Realtime Database)
    provideFirestore(() => getFirestore()),     // Para tu app (Firestore)
  ]
};
