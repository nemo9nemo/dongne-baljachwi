import { Capacitor } from '@capacitor/core'

export const isNativeDevice = Capacitor.isNativePlatform()

export async function exportBackup(blob: Blob, fileName: string): Promise<void> {
  if (isNativeDevice) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share')
    ])
    const path = 'backups/' + crypto.randomUUID() + '-' + fileName
    await Filesystem.writeFile({ directory: Directory.Cache, path, data: '', recursive: true })
    for (let offset = 0; offset < blob.size; offset += 512 * 1024) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1]!)
        reader.onerror = () => reject(new Error('백업 파일을 준비하지 못했어요.'))
        reader.readAsDataURL(blob.slice(offset, offset + 512 * 1024))
      })
      await Filesystem.appendFile({ directory: Directory.Cache, path, data })
    }
    const file = await Filesystem.getUri({ directory: Directory.Cache, path })
    await Share.share({
      title: '동네 발자취 백업',
      files: [file.uri],
      dialogTitle: '백업 파일을 기기 밖에 보관해주세요'
    })
    return
  }
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
