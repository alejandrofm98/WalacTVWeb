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
    return this.http.get<any>(`${this.base}/api/stats`, { headers: this.getAuthHeaders() }).pipe(
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
    return this.http.get<any[]>(`${this.base}/api/users`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of([]))
    );
  }

  createUser(payload: any): Observable<any> {
    return this.http.post(`${this.base}/api/users`, payload, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error creating user:', err);
        return of(null);
      })
    );
  }

  deleteUser(id: string): Observable<any> {
    return this.http.delete(`${this.base}/api/users/${id}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error deleting user:', err);
        return of(null);
      })
    );
  }

  updateUser(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.base}/api/users/${id}`, payload, { headers: this.getAuthHeaders() }).pipe(
      catchError(err => {
        console.error('Error updating user:', err);
        return of(null);
      })
    );
  }

  reloadTemplate(): Observable<any> {
    return this.http.post(`${this.base}/api/admin/reload-template`, {}, { headers: this.getAuthHeaders() }).pipe(
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
