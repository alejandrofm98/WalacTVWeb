import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withInterceptorsFromDi, withInterceptors} from '@angular/common/http';

import {routes} from './app.routes';
import {environment} from '../environments/environment';
import {authInterceptor} from './interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi(), withInterceptors([authInterceptor]))
  ]
};
