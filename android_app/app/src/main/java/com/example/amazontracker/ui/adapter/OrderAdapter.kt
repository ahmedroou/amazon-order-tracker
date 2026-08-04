package com.example.amazontracker.ui.adapter

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.amazontracker.api.Order
import com.example.amazontracker.databinding.ItemOrderBinding
import com.google.android.material.snackbar.Snackbar

class OrderAdapter : ListAdapter<Order, OrderAdapter.OrderViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): OrderViewHolder {
        val binding = ItemOrderBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return OrderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: OrderViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class OrderViewHolder(private val b: ItemOrderBinding) : RecyclerView.ViewHolder(b.root) {

        fun bind(order: Order) {
            // Product name
            b.tvProductName.text = order.productName ?: "منتج بدون اسم"

            // Date
            b.tvDate.text = order.orderDate?.take(10) ?: "—"

            // Order ID
            b.tvOrderId.text = order.amazonOrderId ?: "—"
            b.btnCopyOrder.setOnClickListener {
                copyToClipboard(it.context, "رقم الطلب", order.amazonOrderId ?: "")
                Snackbar.make(b.root, "✅ تم نسخ رقم الطلب", Snackbar.LENGTH_SHORT).show()
            }

            // Tracking
            if (!order.trackingNumber.isNullOrBlank()) {
                b.trackingRow.visibility = View.VISIBLE
                b.tvTracking.text = order.trackingNumber
                b.btnCopyTracking.setOnClickListener {
                    copyToClipboard(it.context, "رقم التتبع", order.trackingNumber)
                    Snackbar.make(b.root, "✅ تم نسخ رقم التتبع", Snackbar.LENGTH_SHORT).show()
                }
            } else {
                b.trackingRow.visibility = View.GONE
            }

            // Status badge
            val (statusLabel, statusColor) = when (order.status) {
                "delivered" -> "✅ موصّل" to "#10B981"
                "shipped" -> "🚚 شحن" to "#3B82F6"
                "pending" -> "⏳ انتظار" to "#F59E0B"
                "cancelled" -> "❌ ملغي" to "#EF4444"
                "returned" -> "↩️ مُعاد" to "#8B5CF6"
                else -> "❓ غير معروف" to "#6B7280"
            }
            b.tvStatusBadge.text = statusLabel
            b.tvStatusBadge.backgroundTintList =
                android.content.res.ColorStateList.valueOf(Color.parseColor(statusColor))

            // Prices
            b.tvCost.text = order.purchasePrice?.let { "%.1f ر.س".format(it) } ?: "—"
            b.tvSale.text = order.salePrice?.let { "%.1f ر.س".format(it) } ?: "—"
            val profit = order.profit
            if (profit != null) {
                b.tvProfit.text = (if (profit >= 0) "+" else "") + "%.1f ر.س".format(profit)
                b.tvProfit.setTextColor(
                    Color.parseColor(if (profit >= 0) "#10B981" else "#EF4444")
                )
            } else {
                b.tvProfit.text = "—"
            }
        }

        private fun copyToClipboard(ctx: Context, label: String, text: String) {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText(label, text))
        }
    }

    class DiffCallback : DiffUtil.ItemCallback<Order>() {
        override fun areItemsTheSame(a: Order, b: Order) = a.id == b.id
        override fun areContentsTheSame(a: Order, b: Order) = a == b
    }
}
