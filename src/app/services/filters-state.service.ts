import { Injectable } from '@angular/core';

export interface ChannelsFilters {
  selectedGroup: string;
  selectedCountry: string;
  searchQuery: string;
}

@Injectable({
  providedIn: 'root'
})
export class FiltersStateService {
  private readonly STORAGE_KEY = 'walactv_channels_filters';
  
  private filters: ChannelsFilters = {
    selectedGroup: '',
    selectedCountry: '',
    searchQuery: ''
  };

  setFilters(filters: Partial<ChannelsFilters>): void {
    this.filters = { ...this.filters, ...filters };
    this.saveFilters();
  }

  getFilters(): ChannelsFilters {
    this.loadFilters();
    return { ...this.filters };
  }

  clearFilters(): void {
    this.filters = {
      selectedGroup: '',
      selectedCountry: '',
      searchQuery: ''
    };
    this.removeFilters();
  }

  private saveFilters(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.filters));
    } catch (e) {
      console.error('Error saving filters:', e);
    }
  }

  private loadFilters(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.filters = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading filters:', e);
    }
  }

  private removeFilters(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
