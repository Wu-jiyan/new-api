import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  deleteBackground,
  fetchBackgroundLibrary,
  uploadBackground,
  type GlobalBackgroundItem,
} from '@/features/character-admin/api'

export default function CharacterBackgroundsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const { data: list = [] } = useQuery({
    queryKey: ['character-backgrounds'],
    queryFn: fetchBackgroundLibrary,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['character-backgrounds'] })

  const onUpload = async (file?: File) => {
    if (!file) return
    if (!name.trim()) {
      toast.error(t('character.admin.needBackgroundName'))
      return
    }
    setUploading(true)
    try {
      const item = await uploadBackground(name.trim(), file)
      setName('')
      // 即时回显：直接用返回值更新缓存，避免等待重新拉取
      qc.setQueryData<GlobalBackgroundItem[]>(['character-backgrounds'], (old = []) => {
        const exists = old.some((b) => b.id === item.id)
        return exists ? old.map((b) => (b.id === item.id ? item : b)) : [...old, item]
      })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('character.admin.generateFailed'))
    } finally {
      setUploading(false)
    }
  }

  const onDelete = async (id: number) => {
    setDeleting(id)
    try {
      await deleteBackground(id)
      // 即时移除，避免等待重新拉取
      qc.setQueryData<GlobalBackgroundItem[]>(['character-backgrounds'], (old = []) =>
        old.filter((b) => b.id !== id)
      )
      await refresh()
    } catch {
      toast.error(t('character.admin.generateFailed'))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-5xl space-y-6 py-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold'>{t('character.admin.backgroundLibrary')}</h1>
            <p className='mt-1 text-sm text-muted-foreground'>{t('character.admin.backgroundLibraryHint')}</p>
          </div>
          <Button variant='outline' onClick={() => navigate({ to: '/character/admin' })}>
            <ArrowLeft className='h-4 w-4' />
            {t('character.admin.backToCharacters')}
          </Button>
        </div>

        <Card>
          <CardContent className='space-y-3 pt-4'>
            <div className='space-y-1'>
              <Label className='text-xs text-muted-foreground'>{t('character.admin.backgroundName')}</Label>
              <Input
                value={name}
                placeholder={t('character.admin.backgroundNamePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                disabled={!name.trim() || uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Upload className='h-4 w-4' />}
                {t('character.admin.upload')}
              </Button>
              <input
                ref={(el) => {
                  fileRef.current = el
                }}
                type='file'
                accept='image/*'
                className='hidden'
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
            </div>
          </CardContent>
        </Card>

        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {list.map((bg) => (
            <Card key={bg.id}>
              <CardContent className='space-y-2 pt-4'>
                <div className='aspect-video overflow-hidden rounded-md border bg-muted'>
                  <img src={bg.image_url} alt={bg.name} className='h-full w-full object-cover' />
                </div>
                <div className='flex items-center justify-between gap-2'>
                  <span className='truncate text-sm font-medium'>{bg.name}</span>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    disabled={deleting === bg.id}
                    onClick={() => onDelete(bg.id)}
                  >
                    {deleting === bg.id ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <Trash2 className='h-4 w-4' />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {list.length === 0 && (
          <div className='flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground'>
            <Plus className='h-6 w-6' />
            <span>{t('character.admin.noBackgrounds')}</span>
          </div>
        )}
      </div>
    </main>
  )
}
