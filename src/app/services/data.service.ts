import {Injectable} from '@angular/core';
import {Firestore, collectionData, collection, doc, docData, getDoc} from '@angular/fire/firestore';
import {map, Observable} from 'rxjs';

@Injectable({providedIn: 'root'})
export class DataService {
  constructor(private firestore: Firestore) {
  }

 getItems(): Observable<any> {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateString = `${day}.${month}.${year}`;
    const documentName = `eventos_${dateString}`;
    
  const docRef = doc(this.firestore, "tvLibreEventos", documentName);
  return docData(docRef, {idField: 'id'}).pipe(
    map((documento: any) => {
      console.log('Documento recibido:', documento);
      // Si tu documento tiene una propiedad 'eventos' que es un array
      return documento;
    })
  );
}
}
