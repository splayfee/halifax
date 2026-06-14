/**
 * Halifax Client — React + TanStack Query example
 *
 * Install:
 *   pnpm add @edium/halifax-client @tanstack/react-query
 */

import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useState } from 'react'
import { HalifaxClient, QueryBuilder, SqlComparison, SqlOrder, HalifaxError } from '@edium/halifax-client'
import type { ListResult, QueryResult } from '@edium/halifax-client'

// ─── 1. Types ─────────────────────────────────────────────────────────────────

interface User {
  id: number
  name: string
  email: string
  status: 'active' | 'inactive'
  role: 'admin' | 'user' | 'viewer'
  createdAt: string
}

type CreateUser = Omit<User, 'id' | 'createdAt'>
type UpdateUser = Partial<CreateUser>

// ─── 2. Client setup ──────────────────────────────────────────────────────────

const client = new HalifaxClient({
  baseUrl: 'http://localhost:3000',

  // Dynamic auth header — called before every request so the token is always fresh.
  headers: () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  },

  // Uncomment if your server uses `CrudApiOptions.envelope: 'data'`
  // envelope: 'data',
})

// Typed resource clients — create them once and re-use throughout the app.
const users = client.resource<User, CreateUser, UpdateUser>('users')

// ─── 3. Hooks ─────────────────────────────────────────────────────────────────

/** Paginated list of users with optional status filter. */
function useUsers(status?: User['status'], page = 0) {
  return useQuery({
    ...users.getManyOptions({
      limit: 20,
      offset: page * 20,
      order: ['-createdAt'],
      ...(status ? { status } : {})
    }),
    staleTime: 30_000
  })
}

/** Single user by id. */
function useUser(id: number) {
  return useQuery({
    ...users.getOneOptions(id),
    enabled: id > 0
  })
}

/**
 * Full-text search with the AST query builder — posted to POST /users/query.
 *
 * The server validates the AST against the resource's field definitions, so
 * only filterable fields can be used in WHERE clauses.
 */
function useUserSearch(search: string, role?: User['role']): ReturnType<typeof useQuery<QueryResult<User>>> {
  const query = new QueryBuilder()
    .orGroup('name', SqlComparison.Contains, search, (b) =>
      b.or('email', SqlComparison.Contains, search)
    )

  if (role) query.and('role', SqlComparison.Equal, role)

  query.where('status', SqlComparison.Equal, 'active').orderBy('name', SqlOrder.ASC).limit(50)

  return useQuery({
    ...users.queryOptions(query),
    enabled: search.length > 1
  })
}

/** Create a user. Invalidates all user list caches on success. */
function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUser) => users.createOne(data),
    onSuccess: () => {
      // Invalidate every cache key that starts with 'users'
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}

/** Update a user. Optimistically updates the detail cache. */
function useUpdateUser(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateUser) => users.updateOne(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(users.detailKey(id), updated)
      void queryClient.invalidateQueries({ queryKey: users.listKey() })
    }
  })
}

/** Delete a user and remove it from all caches. */
function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => users.deleteOne(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: users.detailKey(id) })
      void queryClient.invalidateQueries({ queryKey: users.listKey() })
    }
  })
}

// ─── 4. Components ────────────────────────────────────────────────────────────

function UserList() {
  const [status, setStatus] = useState<User['status'] | undefined>()
  const [page, setPage] = useState(0)
  const { data, isLoading, error } = useUsers(status, page)
  const deleteUser = useDeleteUser()

  if (isLoading) return <p>Loading…</p>
  if (error) {
    const msg = error instanceof HalifaxError ? error.message : 'Failed to load users'
    return <p>Error: {msg}</p>
  }

  const result = data as ListResult<User>

  return (
    <div>
      <label>
        Filter:{' '}
        <select onChange={(e) => setStatus((e.target.value as User['status']) || undefined)}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>

      <p>{result.count} users total</p>

      <ul>
        {result.results.map((user) => (
          <li key={user.id}>
            {user.name} — {user.role}
            <button onClick={() => deleteUser.mutate(user.id)}>Delete</button>
          </li>
        ))}
      </ul>

      <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
        Prev
      </button>
      <button
        disabled={result.count <= (page + 1) * 20}
        onClick={() => setPage((p) => p + 1)}
      >
        Next
      </button>
    </div>
  )
}

function UserSearch() {
  const [search, setSearch] = useState('')
  const { data, isFetching } = useUserSearch(search)

  const result = data as QueryResult<User> | undefined

  return (
    <div>
      <input
        placeholder="Search name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isFetching && <span> Searching…</span>}
      <ul>
        {result?.results.map((u) => (
          <li key={u.id}>{u.name} — {u.email}</li>
        ))}
      </ul>
    </div>
  )
}

// ─── 5. App wiring ────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 }
  }
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserSearch />
      <UserList />
    </QueryClientProvider>
  )
}
