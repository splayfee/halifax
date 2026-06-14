/**
 * Halifax Client — Vue 3 + TanStack Vue Query example
 *
 * Install:
 *   pnpm add @edium/halifax-client @tanstack/vue-query
 *
 * App setup (main.ts):
 *
 *   import { createApp } from 'vue'
 *   import { VueQueryPlugin } from '@tanstack/vue-query'
 *   import App from './App.vue'
 *
 *   createApp(App).use(VueQueryPlugin).mount('#app')
 */

import { computed, ref } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { HalifaxClient, QueryBuilder, SqlComparison, SqlOrder } from '@edium/halifax-client'
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
  headers: () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
})

const users = client.resource<User, CreateUser, UpdateUser>('users')

// ─── 3. Composables ───────────────────────────────────────────────────────────

/**
 * Paginated user list.
 *
 * The queryKey is reactive via `computed` — TanStack Vue Query re-fetches
 * automatically whenever `status` or `page` changes.
 */
export function useUsers(status?: Ref<User['status'] | undefined>, page?: Ref<number>) {
  return useQuery(
    computed(() =>
      users.getManyOptions({
        limit: 20,
        offset: (page?.value ?? 0) * 20,
        order: ['-createdAt'],
        ...(status?.value ? { status: status.value } : {})
      })
    )
  )
}

/** Single user detail. */
export function useUser(id: Ref<number>) {
  return useQuery(
    computed(() => ({
      ...users.getOneOptions(id.value),
      enabled: id.value > 0
    }))
  )
}

/**
 * AST-powered search — posted to POST /users/query.
 * Re-runs reactively as `search` or `role` change.
 */
export function useUserSearch(search: Ref<string>, role?: Ref<User['role'] | undefined>) {
  return useQuery(
    computed(() => {
      const q = new QueryBuilder()
        .orGroup('name', SqlComparison.Contains, search.value, (b) =>
          b.or('email', SqlComparison.Contains, search.value)
        )
        .and('status', SqlComparison.Equal, 'active')
        .orderBy('name', SqlOrder.ASC)
        .limit(50)

      if (role?.value) q.and('role', SqlComparison.Equal, role.value)

      return {
        ...users.queryOptions(q),
        enabled: search.value.length > 1
      }
    })
  )
}

/** Create a user and bust list caches. */
export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUser) => users.createOne(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}

/** Update a single user; write to detail cache immediately. */
export function useUpdateUser(id: Ref<number>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateUser) => users.updateOne(id.value, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(users.detailKey(id.value), updated)
      void queryClient.invalidateQueries({ queryKey: users.listKey() })
    }
  })
}

/** Delete a user and clean up caches. */
export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => users.deleteOne(userId),
    onSuccess: (_result, userId) => {
      queryClient.removeQueries({ queryKey: users.detailKey(userId) })
      void queryClient.invalidateQueries({ queryKey: users.listKey() })
    }
  })
}

// ─── 4. Example component usage (in a .vue SFC) ───────────────────────────────
//
// <script setup lang="ts">
// import { ref } from 'vue'
// import { useUsers, useUserSearch, useCreateUser, useDeleteUser } from './composables/users'
//
// const page = ref(0)
// const status = ref<'active' | 'inactive' | undefined>()
// const search = ref('')
//
// const { data: listData, isLoading } = useUsers(status, page)
// const { data: searchData, isFetching } = useUserSearch(search)
// const createUser = useCreateUser()
// const deleteUser = useDeleteUser()
//
// const totalPages = computed(() => Math.ceil((listData.value?.count ?? 0) / 20))
// </script>
//
// <template>
//   <input v-model="search" placeholder="Search…" />
//   <p v-if="isFetching">Searching…</p>
//   <ul v-else>
//     <li v-for="u in searchData?.results" :key="u.id">{{ u.name }}</li>
//   </ul>
//
//   <p v-if="isLoading">Loading…</p>
//   <ul v-else>
//     <li v-for="u in listData?.results" :key="u.id">
//       {{ u.name }}
//       <button @click="deleteUser.mutate(u.id)">Delete</button>
//     </li>
//   </ul>
//
//   <button :disabled="page === 0" @click="page--">Prev</button>
//   <button :disabled="page >= totalPages - 1" @click="page++">Next</button>
// </template>

// ─── 5. Bulk operations example ───────────────────────────────────────────────

export function bulkExamples() {
  // Deactivate all viewers — requires at least one WHERE filter on the server
  async function deactivateViewers() {
    const query = new QueryBuilder().where('role', SqlComparison.Equal, 'viewer')
    return users.updateMany(query, { status: 'inactive' })
  }

  // Delete all inactive users older than a date
  async function purgeInactive(before: string) {
    const query = new QueryBuilder()
      .where('status', SqlComparison.Equal, 'inactive')
      .and('createdAt', SqlComparison.LessThan, before)
    return users.deleteMany(query)
  }

  // Search with BETWEEN for numeric range
  async function findSeniorAdmins(minAge: number, maxAge: number) {
    const query = new QueryBuilder()
      .where('role', SqlComparison.Equal, 'admin')
      .and('age', SqlComparison.Between, minAge, maxAge)
      .orderBy('name')
    return users.query(query)
  }

  return { deactivateViewers, purgeInactive, findSeniorAdmins }
}

// Needed for the ref type in composable signatures
import type { Ref } from 'vue'
