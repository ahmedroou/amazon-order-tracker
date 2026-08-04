package com.example.amazontracker.api

import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    @GET("api/stats")
    suspend fun getStats(): Response<Stats>

    @GET("api/orders")
    suspend fun getOrders(
        @Query("status") status: String? = null,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0
    ): Response<OrdersResponse>

    @GET("api/analytics")
    suspend fun getAnalytics(
        @Query("period") period: String = "all"
    ): Response<Stats>

    @GET("api/sync/status")
    suspend fun getSyncStatus(): Response<SyncStatus>

    @POST("api/sync")
    suspend fun syncNow(): Response<SyncResponse>

    @POST("api/sync/ai")
    suspend fun syncAI(): Response<SyncResponse>

    @GET("api/accounts")
    suspend fun getAccounts(): Response<List<Account>>
}
