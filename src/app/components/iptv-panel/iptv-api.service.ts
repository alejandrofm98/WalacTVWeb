import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class IptvApiService {
  private base = environment.iptvApiUrl.replace(/\/+$/, '');
  private authService = inject(AuthService);

  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const headers = this.authService.getAuthHeaders();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...headers
    });
  }

  getStats(): Observable<any> {
    return this.http.get<any>(`${this.base}/api/admin/stats`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of({
        total_users: 0,
        active_users: 0,
        total_sessions: 0,
        total_channels: 0,
        total_movies: 0,
        total_series: 0
      }))
    );
  }

  getUsers(): Observable<any[]> {
    return this.http.get<any>(`${this.base}/api/admin/users`, { headers: this.getAuthHeaders() }).pipe(
      map(response => response?.items || []),
      catchError(() => of([]))
    );
  }

  createUser(payload: any): Observable<any> {
    return this.http.post(`${this.base}/api/admin/users`, payload, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error creating user:', err);
        return of(null);
      })
    );
  }

  deleteUser(id: string): Observable<any> {
    return this.http.delete(`${this.base}/api/admin/users/${id}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error deleting user:', err);
        return of(null);
      })
    );
  }

  updateUser(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.base}/api/admin/users/${id}`, payload, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error updating user:', err);
        return of(null);
      })
    );
  }

  getSessions(): Observable<any[]> {
    return this.http.get<any>(`${this.base}/api/admin/sessions`, { headers: this.getAuthHeaders() }).pipe(
      map(response => response?.items || []),
      catchError(() => of([]))
    );
  }

  getUserDevices(userId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/admin/users/${userId}/devices`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of([]))
    );
  }

  disconnectDevice(userId: string, deviceId: string): Observable<any> {
    return this.http.delete(`${this.base}/api/admin/users/${userId}/devices/${deviceId}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error disconnecting device:', err);
        return of(null);
      })
    );
  }

  disconnectAllDevices(userId: string): Observable<any> {
    return this.http.delete(`${this.base}/api/admin/users/${userId}/devices`, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error disconnecting all devices:', err);
        return of(null);
      })
    );
  }

  reloadTemplate(): Observable<any> {
    return this.http.post(`${this.base}/api/admin/content/reload`, {}, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error reloading template:', err);
        return of(null);
      })
    );
  }

  getSystemStats(): Observable<any> {
    return this.getStats();
  }

  getContentGroups(): Observable<string[]> {
    return this.http.get<{ groups: string[] }>(`${this.base}/api/content/groups`).pipe(
      map(response => response.groups || []),
      catchError(() => of([]))
    );
  }

  getContentCountries(): Observable<string[]> {
    return this.http.get<{ countries: string[] }>(`${this.base}/api/content/countries`).pipe(
      map(response => response.countries || []),
      catchError(() => of([]))
    );
  }
}
