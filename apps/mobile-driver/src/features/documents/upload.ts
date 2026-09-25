import type { DocumentType } from '@neomoov/domain';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Photo d'un document (6.2 : « appareil photo et recadrage ») : l'appareil photo avec recadrage, ou une photo déjà
 * prise ; compression JPEG pour rester loin de la limite de 10 Mo. Renvoie null si l'utilisateur annule.
 */
export async function pickDocumentPhoto(source: 'camera' | 'library'): Promise<PickedFile | 'denied' | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: true, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { uri: asset.uri, name: asset.fileName ?? `document.${extension}`, mimeType };
}

/** Formulaire multipart de `POST /driver/documents` : champs texte et fichier (objet `{ uri }` sur mobile, Blob sur le web). */
export async function documentForm(input: { type: DocumentType; file: PickedFile; number?: string; expiresOn?: string }): Promise<FormData> {
  const form = new FormData();
  form.append('type', input.type);
  if (input.number) form.append('number', input.number);
  if (input.expiresOn) form.append('expiresOn', input.expiresOn);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(input.file.uri)).blob();
    form.append('file', blob, input.file.name);
  } else {
    form.append('file', { uri: input.file.uri, name: input.file.name, type: input.file.mimeType } as unknown as Blob);
  }
  return form;
}
