import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: 'admin' | 'user';
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  max_connections: number;
  is_active: boolean;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private apiUrl = environment.iptvApiUrl.replace(/\/+$/, '');

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private tokenSubject = new BehaviorSubject<string | null>(null);

  currentUser$ = this.currentUserSubject.asObservable();
  token$ = this.tokenSubject.asObservable();

  private deviceId: string;
  private activityInterval: ReturnType<typeof setInterval> | null = null;
  private isLoggingIn = false;
  private isManualLogout = false;

  constructor() {
    this.deviceId = this.generateUniqueId();
    console.log('🆔 Device ID generado:', this.deviceId);
    this.loadStoredSession();
  }

  private generateUniqueId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadStoredSession(): void {
    const token = localStorage.getItem('iptv_token');
    const user = localStorage.getItem('iptv_user');

    if (token && user) {
      try {
        const userData = JSON.parse(user);
        this.tokenSubject.next(token);
        this.currentUserSubject.next(userData);
        console.log('✅ Sesión restaurada desde localStorage');
        this.startActivityPing();
      } catch {
        this.clearSession();
      }
    }
  }

  async login(username: string, password: string, forceLogin: boolean = false): Promise<{ success: boolean; user?: User; requiresConfirmation?: boolean; message?: string }> {
    if (this.isLoggingIn) {
      return { success: false, message: 'Login en progreso' };
    }

    this.isLoggingIn = true;

    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const response = await this.http.post<LoginResponse>(
        `${this.apiUrl}/api/auth/login`,
        formData,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      ).toPromise();

      if (response?.access_token) {
        const user: User = {
          id: '',
          username: username,
          email: '',
          role: response.role,
          max_connections: 1,
          is_active: true,
          created_at: new Date().toISOString()
        };

        localStorage.setItem('iptv_token', response.access_token);
        localStorage.setItem('iptv_user', JSON.stringify(user));
        localStorage.setItem('iptv_username', username);
        localStorage.setItem('iptv_password', password);

        this.tokenSubject.next(response.access_token);
        this.currentUserSubject.next(user);
        this.startActivityPing();

        console.log('✅ Login exitoso');
        this.isLoggingIn = false;

        return { success: true, user };
      }

      this.isLoggingIn = false;
      return { success: false, message: 'Respuesta inválida del servidor' };
    } catch (error: any) {
      console.error('❌ Error en login:', error);
      this.isLoggingIn = false;

      if (error.status === 429) {
        return { success: false, message: 'Límite de dispositivos alcanzado' };
      }

      const message = error.error?.detail || 'Error al iniciar sesión';
      return { success: false, message };
    }
  }

  async logout(): Promise<void> {
    console.log('🚪 Cerrando sesión');

    this.isManualLogout = true;
    this.stopActivityPing();

    this.clearSession();

    this.isManualLogout = false;
  }

  private clearSession(): void {
    localStorage.removeItem('iptv_token');
    localStorage.removeItem('iptv_user');
    localStorage.removeItem('iptv_username');
    localStorage.removeItem('iptv_password');

    this.tokenSubject.next(null);
    this.currentUserSubject.next(null);
    this.stopActivityPing();
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getToken(): string | null {
    return this.tokenSubject.value;
  }

  getUsername(): string | null {
    return localStorage.getItem('iptv_username');
  }

  getPassword(): string | null {
    return localStorage.getItem('iptv_password');
  }

  isAuthenticated(): boolean {
    return !!this.tokenSubject.value && !!this.currentUserSubject.value;
  }

  isAdmin(): boolean {
    return this.currentUserSubject.value?.role === 'admin';
  }

  private startActivityPing(): void {
    this.stopActivityPing();

    if (!this.isAuthenticated()) return;

    this.activityInterval = setInterval(() => {
      console.log('⏰ Ping de actividad');
    }, 30000);
  }

  private stopActivityPing(): void {
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }
  }

  getAuthHeaders(): { [header: string]: string } {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }
}
