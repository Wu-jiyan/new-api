import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ImageIcon, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

import { deleteCharacter, fetchAdminCharacters } from './api'
import type { CharacterAdminItem } from './types'

export default function CharacterAdminPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')

  const { data: list = [] } = useQuery({
    queryKey: ['character-admin', keyword],
    queryFn: () => fetchAdminCharacters(keyword),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['character-admin'] })

  const delMut = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      toast.success(t('common.success'))
      refresh()
    },
  })

  const openEditor = (item: CharacterAdminItem) => {
    navigate({
      to: '/character/admin/characters/$modelName',
      params: { modelName: encodeURIComponent(item.model_name) },
    })
  }

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold'>{t('character.admin.title')}</h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {t('character.admin.subtitle')}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Input
              placeholder={t('character.admin.search')}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className='w-56'
            />
            <Button variant='outline' onClick={() => navigate({ to: '/character/admin/backgrounds' })}>
              <ImageIcon className='h-4 w-4' />
              {t('character.admin.backgroundLibrary')}
            </Button>
            <Button
              onClick={() =>
                navigate({
                  to: '/character/admin/characters/$modelName',
                  params: { modelName: 'new' },
                })
              }
            >
              <Plus className='h-4 w-4' />
              {t('character.admin.create')}
            </Button>
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {list.map((item) => (
            <Card
              key={item.id}
              className='cursor-pointer transition-colors hover:bg-muted/40'
              onClick={() => openEditor(item)}
            >
              <CardHeader className='pb-2'>
                <CardTitle className='text-base'>
                  {item.display_name || item.model_name}
                  <span className='ml-2 text-xs font-normal text-muted-foreground'>
                    {item.model_name}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className='flex items-center justify-between'>
                <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <span>{item.title || '—'}</span>
                </div>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditor(item)
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive'
                    onClick={(e) => {
                      e.stopPropagation()
                      delMut.mutate(item.id)
                    }}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {list.length === 0 && (
          <div className='flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground'>
            <Plus className='h-6 w-6' />
            <span>{t('character.admin.noCharacters')}</span>
          </div>
        )}
      </div>
    </main>
  )
}
