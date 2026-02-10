import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
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
  page: number;
  page_size: number;
  pages: number;
  has_next: boolean;
  has_prev: boolean;
  items: T[];
}

export interface CountryResponse {
  code: string;
  name: string;
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
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

  private buildParams(page: number, pageSize: number, group?: string, country?: string, search?: string): HttpParams {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());

    if (group) params = params.set('group', group);
    if (country) params = params.set('country', country);
    if (search) params = params.set('search', search);

    return params;
  }

  getChannels(page: number = 1, pageSize: number = 80, group?: string, country?: string, search?: string): Observable<PaginatedResponse<IptvChannel>> {
    let params = this.buildParams(page, pageSize, group, country, search);
    params = params.set('content_type', 'channels');

    return this.http.get<PaginatedResponse<IptvChannel>>(
      `${this.apiUrl}/api/content`,
      { headers: this.getHeaders(), params }
    ).pipe(
      catchError(() => of({ total: 0, page, page_size: pageSize, pages: 0, has_next: false, has_prev: false, items: [] }))
    );
  }

  getChannel(id: string): Observable<IptvChannel | null> {
    return this.http.get<IptvChannel>(
      `${this.apiUrl}/api/content/channels/${id}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getMovies(page: number = 1, pageSize: number = 80, group?: string, country?: string, search?: string): Observable<PaginatedResponse<IptvMovie>> {
    let params = this.buildParams(page, pageSize, group, country, search);
    params = params.set('content_type', 'movies');

    return this.http.get<PaginatedResponse<IptvMovie>>(
      `${this.apiUrl}/api/content`,
      { headers: this.getHeaders(), params }
    ).pipe(
      catchError(() => of({ total: 0, page, page_size: pageSize, pages: 0, has_next: false, has_prev: false, items: [] }))
    );
  }

  getMovie(id: string): Observable<IptvMovie | null> {
    return this.http.get<IptvMovie>(
      `${this.apiUrl}/api/content/movies/${id}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getSeries(page: number = 1, pageSize: number = 80, group?: string, country?: string, search?: string): Observable<PaginatedResponse<IptvSeries>> {
    let params = this.buildParams(page, pageSize, group, country, search);
    params = params.set('content_type', 'series');

    return this.http.get<PaginatedResponse<IptvSeries>>(
      `${this.apiUrl}/api/content`,
      { headers: this.getHeaders(), params }
    ).pipe(
      catchError(() => of({ total: 0, page, page_size: pageSize, pages: 0, has_next: false, has_prev: false, items: [] }))
    );
  }

  getSerie(id: string): Observable<IptvSeries | null> {
    return this.http.get<IptvSeries>(
      `${this.apiUrl}/api/content/series/${id}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(() => of(null))
    );
  }

  getGroups(contentType: 'channels' | 'movies' | 'series' = 'channels'): Observable<string[]> {
    return this.http.get<{ groups: string[] }>(
      `${this.apiUrl}/api/content/groups?content_type=${contentType}`,
      { headers: this.getHeaders() }
    ).pipe(
      map(response => response.groups || []),
      catchError(() => of([]))
    );
  }

  getCountries(contentType: 'channels' | 'movies' | 'series' = 'channels'): Observable<CountryResponse[]> {
    return this.http.get<{ countries: CountryResponse[] }>(
      `${this.apiUrl}/api/content/countries?content_type=${contentType}`,
      { headers: this.getHeaders() }
    ).pipe(
      map(response => response.countries || []),
      catchError(() => of([]))
    );
  }

  getCounts(): Observable<{ channels: number; movies: number; series: number }> {
    return of({ channels: 0, movies: 0, series: 0 });
  }

  getStreamUrl(type: 'live' | 'movie' | 'series', streamId: string): string {
    const username = localStorage.getItem('iptv_username') || '';
    const password = localStorage.getItem('iptv_password') || '';
    return `${this.apiUrl}/stream/${type}/${username}/${password}/${streamId}`;
  }

  searchAll(query: string, limit: number = 20): Observable<{
    channels: IptvChannel[];
    movies: IptvMovie[];
    series: IptvSeries[];
  }> {
    if (!query.trim()) {
      return of({ channels: [], movies: [], series: [] });
    }

    return of({
      channels: [] as IptvChannel[],
      movies: [] as IptvMovie[],
      series: [] as IptvSeries[]
    });
  }
}
