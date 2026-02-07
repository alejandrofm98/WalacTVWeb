import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'https',
  standalone: true
})
export class HttpsPipe implements PipeTransform {
  transform(url: string | null | undefined): string {
    if (!url) return '';
    return url.replace(/^http:\/\//i, 'https://');
  }
}
