import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedPhoto {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Photo d'une étape du parcours guidé de la vérification sommaire, ou capture d'écran d'un rapport de performance :
 * appareil photo (sans recadrage, le cadre guide la prise) ou photothèque ; compression JPEG. `denied` : permission refusée.
 */
export async function pickBoosterPhoto(source: 'camera' | 'library', options: { multiple?: boolean } = {}): Promise<PickedPhoto[] | 'denied'> {
  const common: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
    result = await ImagePicker.launchCameraAsync(common);
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ ...common, allowsMultipleSelection: options.multiple ?? false, selectionLimit: options.multiple ? 6 : 1 });
  }
  if (result.canceled) return [];
  return result.assets.map((asset, index) => {
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    return { uri: asset.uri, name: asset.fileName ?? `photo-${index + 1}.${extension}`, mimeType };
  });
}

async function appendFile(form: FormData, field: string, file: PickedPhoto): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, blob, file.name);
  } else {
    form.append(field, { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
}

/** Formulaire multipart des photos d'une inspection (`photos`), avec leurs vues dans l'ordre (`kinds`). */
export async function inspectionForm(photos: Array<{ kind: string; file: PickedPhoto }>, fields: Record<string, string | undefined> = {}): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
  form.append('kinds', photos.map((p) => p.kind).join(','));
  for (const photo of photos) await appendFile(form, 'photos', photo.file);
  return form;
}

/** Formulaire multipart des captures d'écran d'un rapport de performance (`screenshots`). */
export async function screenshotsForm(files: PickedPhoto[]): Promise<FormData> {
  const form = new FormData();
  for (const file of files) await appendFile(form, 'screenshots', file);
  return form;
}
