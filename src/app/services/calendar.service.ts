import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { CalendarDayResponse, CalendarEvent } from '../models/calendar.model';

@Injectable({
  providedIn: 'root'
})
export class CalendarService {
  private http = inject(HttpClient);
  private apiUrl = environment.iptvApiUrl.replace(/\/+$/, '');
  private authService = inject(AuthService);

  private getHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    });
  }

  /**
   * Obtiene todos los eventos de una fecha específica
   * @param fecha Fecha en formato YYYY-MM-DD
   */
  getEventsByDate(fecha: string): Observable<CalendarDayResponse> {
    return this.http.get<CalendarDayResponse>(
      `${this.apiUrl}/api/calendar/${fecha}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(() => of({ fecha, total_eventos: 0, eventos: [] }))
    );
  }

  /**
   * Obtiene un evento específico por su ID
   * @param eventId UUID del evento
   */
  getEventById(eventId: string): Observable<CalendarEvent | null> {
    return this.http.get<CalendarEvent>(
      `${this.apiUrl}/api/calendar/event/${eventId}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(() => of(null))
    );
  }

  /**
   * Obtiene los eventos del día actual
   */
  getTodayEvents(): Observable<CalendarDayResponse> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return this.getEventsByDate(today);
  }

  /**
   * Obtiene los eventos de una fecha específica formateada
   * @param date Objeto Date
   */
  getEventsByDateObject(date: Date): Observable<CalendarDayResponse> {
    const fecha = date.toISOString().split('T')[0];
    return this.getEventsByDate(fecha);
  }
}
