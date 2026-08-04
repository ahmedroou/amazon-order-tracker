package com.example.amazontracker.api

import com.google.gson.annotations.SerializedName

data class Order(
    val id: Int = 0,
    @SerializedName("amazon_order_id") val amazonOrderId: String? = null,
    @SerializedName("product_name") val productName: String? = null,
    @SerializedName("purchase_price") val purchasePrice: Double? = null,
    @SerializedName("sale_price") val salePrice: Double? = null,
    val profit: Double? = null,
    val status: String? = null,
    @SerializedName("to_email") val toEmail: String? = null,
    @SerializedName("order_date") val orderDate: String? = null,
    val carrier: String? = null,
    @SerializedName("tracking_number") val trackingNumber: String? = null,
    val notes: String? = null,
    @SerializedName("account_id") val accountId: Int? = null
)

data class OrdersResponse(
    val total: Int = 0,
    val orders: List<Order> = emptyList()
)

data class Stats(
    @SerializedName("total_orders") val totalOrders: Int = 0,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("total_revenue") val totalRevenue: Double = 0.0,
    @SerializedName("total_profit") val totalProfit: Double = 0.0,
    @SerializedName("by_status") val byStatus: Map<String, Int> = emptyMap(),
    @SerializedName("by_email") val byEmail: List<EmailStats> = emptyList(),
    @SerializedName("recent_days") val recentDays: List<DayStats> = emptyList()
)

data class EmailStats(
    val email: String = "",
    val count: Int = 0,
    val spent: Double = 0.0
)

data class DayStats(
    val day: String = "",
    val count: Int = 0
)

data class SyncStatus(
    @SerializedName("is_syncing") val isSyncing: Boolean = false,
    val progress: Int = 0,
    val message: String? = null
)

data class SyncResponse(
    val success: Boolean = false,
    val message: String? = null
)

data class Account(
    val id: Int = 0,
    val email: String = "",
    @SerializedName("is_active") val isActive: Boolean = true
)
