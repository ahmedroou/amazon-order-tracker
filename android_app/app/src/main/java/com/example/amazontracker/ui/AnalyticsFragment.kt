package com.example.amazontracker.ui

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.example.amazontracker.api.ApiClient
import com.example.amazontracker.databinding.FragmentAnalyticsBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch

class AnalyticsFragment : Fragment() {

    private var _binding: FragmentAnalyticsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentAnalyticsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.swipeRefresh.setColorSchemeResources(android.R.color.holo_orange_dark)
        binding.swipeRefresh.setOnRefreshListener { loadAnalytics() }
        loadAnalytics()
    }

    private fun loadAnalytics() {
        lifecycleScope.launch {
            try {
                val resp = ApiClient.api.getStats()
                if (resp.isSuccessful) {
                    val s = resp.body()!!

                    // Financials
                    binding.tvTotalCost.text = "%.2f".format(s.totalCost)
                    binding.tvTotalRevenue.text = "%.2f".format(s.totalRevenue)
                    binding.tvNetProfit.text = (if (s.totalProfit >= 0) "+" else "") + "%.2f".format(s.totalProfit)
                    binding.tvNetProfit.setTextColor(
                        Color.parseColor(if (s.totalProfit >= 0) "#10B981" else "#EF4444")
                    )

                    // Status breakdown
                    binding.statusBreakdown.removeAllViews()
                    val statuses = mapOf(
                        "delivered" to ("✅ موصّل" to "#10B981"),
                        "shipped" to ("🚚 جاري الشحن" to "#3B82F6"),
                        "pending" to ("⏳ انتظار" to "#F59E0B"),
                        "cancelled" to ("❌ ملغي" to "#EF4444"),
                        "returned" to ("↩️ مُعاد" to "#8B5CF6")
                    )
                    val total = s.totalOrders.coerceAtLeast(1).toFloat()
                    statuses.forEach { (key, pair) ->
                        val count = s.byStatus[key] ?: 0
                        if (count > 0) {
                            addStatusRow(binding.statusBreakdown, pair.first, count, total, pair.second)
                        }
                    }

                    // Accounts breakdown
                    binding.accountsBreakdown.removeAllViews()
                    s.byEmail.forEach { acc ->
                        addAccountRow(binding.accountsBreakdown, acc.email, acc.count, acc.spent)
                    }
                }
            } catch (e: Exception) {
                Snackbar.make(binding.root, "⚠️ تعذّر الاتصال", Snackbar.LENGTH_LONG).show()
            } finally {
                binding.swipeRefresh.isRefreshing = false
            }
        }
    }

    private fun addStatusRow(parent: LinearLayout, label: String, count: Int, total: Float, color: String) {
        val ctx = requireContext()
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 14 }
        }

        val topRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 6 }
        }

        val labelView = TextView(ctx).apply {
            text = label; textSize = 13f
            setTextColor(Color.parseColor("#374151"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val countView = TextView(ctx).apply {
            text = "$count (${(count / total * 100).toInt()}%)"
            textSize = 13f; setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor(color))
        }

        topRow.addView(labelView)
        topRow.addView(countView)

        // Progress bar
        val progressBg = View(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 10).also {
                it.bottomMargin = 2
            }
            setBackgroundColor(Color.parseColor("#F3F4F6"))
        }
        val progressFill = View(ctx).apply {
            val pct = (count / total)
            layoutParams = LinearLayout.LayoutParams(0, 10).also { it.weight = pct }
            setBackgroundColor(Color.parseColor(color))
        }
        val progressContainer = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 10)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F3F4F6"))
                cornerRadius = 20f
            }
        }
        progressContainer.addView(progressFill)

        row.addView(topRow)
        row.addView(progressContainer)
        parent.addView(row)
    }

    private fun addAccountRow(parent: LinearLayout, email: String, count: Int, spent: Double) {
        val ctx = requireContext()
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 12 }
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val emailView = TextView(ctx).apply {
            text = "📧 $email"; textSize = 13f
            setTextColor(Color.parseColor("#374151"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val statsView = TextView(ctx).apply {
            text = "$count طلب  •  ${"%.0f".format(spent)} ر.س"
            textSize = 12f; setTextColor(Color.parseColor("#6B7280"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        row.addView(emailView)
        row.addView(statsView)
        parent.addView(row)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
