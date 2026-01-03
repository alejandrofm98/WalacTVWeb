import {Calidad} from './calidad.model';

export interface Enlaces {
  canal: string;
  link: string;
  calidades?: Calidad[];
  m3u8?: string | string[];
}
