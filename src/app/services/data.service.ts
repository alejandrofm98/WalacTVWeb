import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface IptvChannel {
  id: string;
  num: number;
  nombre: string;
  logo: string;
  grupo: string;
  country: string;
  provider_id: string;
  stream_url: string;
}

export interface IptvMovie {
  id: string;
  num: number;
  nombre: string;
  logo: string;
  grupo: string;
  country: string;
  provider_id: string;
  stream_url: string;
}

export interface IptvSeries {
  id: string;
  num: number;
  nombre: string;
  logo: string;
  grupo: string;
  country: string;
  provider_id: string;
  temporada: string;
  episodio: string;
  stream_url: string;
}

export interface PaginatedResponse<T> {
  total: number;
  skip: number;
  limit: number;
  items: T[];
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private http = inject(HttpClient);
  private apiUrl = environment.iptvApiUrl.replace(/\/+$/, '');

  private getCredentials(): { username: string; password: string } {
    return {
      username: localStorage.getItem('iptv_username') || '',
      password: localStorage.getItem('iptv_password') || ''
    };
  }

  private buildParams(skip: number, limit: number, group?: string, country?: string): HttpParams {
    const { username, password } = this.getCredentials();
    let params = new HttpParams()
      .set('username', username)
      .set('password', password)
      .set('skip', skip.toString())
      .set('limit', limit.toString());

    if (group) params = params.set('group', group);
    if (country) params = params.set('country', country);

    return params;
  }

  getChannels(skip: number = 0, limit: number = 50, group?: string, country?: string): Observable<PaginatedResponse<IptvChannel>> {
    const params = this.buildParams(skip, limit, group, country);

    return this.http.get<PaginatedResponse<IptvChannel>>(
      `${this.apiUrl}/api/channels`,
      { params }
    ).pipe(
      catchError(() => of({ total: 0, skip, limit, items: [] }))
    );
  }

  getChannel(id: string): Observable<IptvChannel | null> {
    const { username, password } = this.getCredentials();
    const params = new HttpParams()
      .set('username', username)
      .set('password', password);

    return this.http.get<IptvChannel>(
      `${this.apiUrl}/api/channels/${id}`,
      { params }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getMovies(skip: number = 0, limit: number = 50, group?: string, country?: string): Observable<PaginatedResponse<IptvMovie>> {
    const params = this.buildParams(skip, limit, group, country);

    return this.http.get<PaginatedResponse<IptvMovie>>(
      `${this.apiUrl}/api/movies`,
      { params }
    ).pipe(
      catchError(() => of({ total: 0, skip, limit, items: [] }))
    );
  }

  getMovie(id: string): Observable<IptvMovie | null> {
    const { username, password } = this.getCredentials();
    const params = new HttpParams()
      .set('username', username)
      .set('password', password);

    return this.http.get<IptvMovie>(
      `${this.apiUrl}/api/movies/${id}`,
      { params }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getSeries(skip: number = 0, limit: number = 50, group?: string, country?: string): Observable<PaginatedResponse<IptvSeries>> {
    const params = this.buildParams(skip, limit, group, country);

    return this.http.get<PaginatedResponse<IptvSeries>>(
      `${this.apiUrl}/api/series`,
      { params }
    ).pipe(
      catchError(() => of({ total: 0, skip, limit, items: [] }))
    );
  }

  getSerie(id: string): Observable<IptvSeries | null> {
    const { username, password } = this.getCredentials();
    const params = new HttpParams()
      .set('username', username)
      .set('password', password);

    return this.http.get<IptvSeries>(
      `${this.apiUrl}/api/series/${id}`,
      { params }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getGroups(contentType: 'channels' | 'movies' | 'series' = 'channels'): Observable<string[]> {
    return this.http.get<{ groups: string[] }>(
      `${this.apiUrl}/api/content/groups`
    ).pipe(
      map(response => response.groups || []),
      catchError(() => of([]))
    );
  }

  getCountries(contentType: 'channels' | 'movies' | 'series' = 'channels'): Observable<string[]> {
    return this.http.get<{ countries: string[] }>(
      `${this.apiUrl}/api/content/countries`
    ).pipe(
      map(response => response.countries || []),
      catchError(() => of([]))
    );
  }

  getCounts(): Observable<{ channels: number; movies: number; series: number }> {
    const { username, password } = this.getCredentials();
    const params = new HttpParams()
      .set('username', username)
      .set('password', password);

    return this.http.get<{ channels: number; movies: number; series: number }>(
      `${this.apiUrl}/api/content/count`,
      { params }
    ).pipe(
      catchError(() => of({ channels: 0, movies: 0, series: 0 }))
    );
  }

  getStreamUrl(type: 'live' | 'movie' | 'series', streamId: string): string {
    return '';
  }
}
