import { createFileRoute } from '@tanstack/react-router'

/**
 * 透传 layout 路由：/character/$modelName 与子路由 /character/$modelName/chat 共存，
 * 详情页放在 index 子路由，否则 chat 子路由没有 <Outlet/> 可渲染。
 */
export const Route = createFileRoute('/_authenticated/character/$modelName')({})
