import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'numberFormat',
  standalone: true
})
export class NumberFormatPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }

    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    
    if (isNaN(num)) {
      return '0';
    }

    return num.toLocaleString('es-ES');
  }
}
