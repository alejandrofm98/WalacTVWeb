import { Injectable } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Observable, from, of, catchError, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DataService {
  constructor(private firestore: Firestore) {}

  /**
   * Obtiene eventos del día actual, si no hay busca en el día anterior
   */
  getItems(): Observable<any> {
    return from(this.fetchEventsWithFallback());
  }

  /**
   * Intenta obtener eventos del día actual, si falla o está vacío busca día anterior
   */
  private async fetchEventsWithFallback(): Promise<any> {
    console.log('🔍 Buscando eventos...');

    // 1. Intentar obtener eventos del día actual
    const todayDocument = await this.tryFetchEvents(0);

    if (todayDocument && this.hasValidEvents(todayDocument)) {
      console.log('✅ Eventos encontrados para hoy');
      return todayDocument;
    }

    console.log('⚠️ No hay eventos para hoy, buscando día anterior...');

    // 2. Si no hay eventos hoy, buscar día anterior
    const yesterdayDocument = await this.tryFetchEvents(-1);

    if (yesterdayDocument && this.hasValidEvents(yesterdayDocument)) {
      console.log('✅ Eventos encontrados para ayer');
      return yesterdayDocument;
    }

    console.log('❌ No se encontraron eventos ni para hoy ni para ayer');

    // 3. Si tampoco hay eventos ayer, retornar estructura vacía
    return {
      dia: this.getDateString(0),
      eventos: []
    };
  }

  /**
   * Intenta obtener eventos de un día específico (offset en días)
   */
  private async tryFetchEvents(daysOffset: number): Promise<any | null> {
    try {
      const dateString = this.getDateString(daysOffset);
      const documentName = `eventos_${dateString}`;

      console.log(`📅 Buscando documento: ${documentName}`);

      const docRef = doc(this.firestore, 'tvLibreEventos', documentName);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        console.log(`📄 Documento encontrado:`, data);
        return data;
      } else {
        console.log(`📄 Documento no existe: ${documentName}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error obteniendo eventos para offset ${daysOffset}:`, error);
      return null;
    }
  }

  /**
   * Verifica si el documento tiene eventos válidos
   */
  private hasValidEvents(document: any): boolean {
    return document &&
           document.eventos &&
           Array.isArray(document.eventos) &&
           document.eventos.length > 0;
  }

  /**
   * Genera string de fecha en formato DD.MM.YYYY con offset de días
   */
  private getDateString(daysOffset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  }

}
