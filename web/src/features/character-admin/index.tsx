import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ImageIcon, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
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
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('character.admin.title')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          onClick={() => navigate({ to: '/character/admin/backgrounds' })}
        >
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
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
          <p className='text-muted-foreground text-sm'>
            {t('character.admin.subtitle')}
          </p>

          <Input
            placeholder={t('character.admin.search')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className='w-56'
          />

          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {list.map((item) => (
              <Card
                key={item.id}
                className='hover:bg-muted/40 cursor-pointer transition-colors'
                onClick={() => openEditor(item)}
              >
                <CardHeader className='pb-2'>
                  <CardTitle className='text-base'>
                    {item.display_name || item.model_name}
                    <span className='text-muted-foreground ml-2 text-xs font-normal'>
                      {item.model_name}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex items-center justify-between'>
                  <div className='text-muted-foreground flex items-center gap-2 text-sm'>
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
            <div className='text-muted-foreground flex flex-col items-center gap-2 py-12 text-sm'>
              <Plus className='h-6 w-6' />
              <span>{t('character.admin.noCharacters')}</span>
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
