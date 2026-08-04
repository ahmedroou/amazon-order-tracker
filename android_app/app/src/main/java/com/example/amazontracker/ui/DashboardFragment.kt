package com.example.amazontracker.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.amazontracker.api.ApiClient
import com.example.amazontracker.api.Order
import com.example.amazontracker.databinding.FragmentDashboardBinding
import com.example.amazontracker.ui.adapter.OrderAdapter
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val adapter = OrderAdapter()
        binding.rvRecentOrders.layoutManager = LinearLayoutManager(requireContext())
        binding.rvRecentOrders.adapter = adapter
        binding.rvRecentOrders.isNestedScrollingEnabled = false

        loadData(adapter)

        binding.swipeRefresh.setColorSchemeResources(android.R.color.holo_orange_dark)
        binding.swipeRefresh.setOnRefreshListener { loadData(adapter) }

        binding.btnSync.setOnClickListener {
            binding.btnSync.isEnabled = false
            binding.btnSync.text = "⏳  جاري المزامنة…"
            triggerSync()
        }
    }

    private fun loadData(adapter: OrderAdapter) {
        lifecycleScope.launch {
            try {
                // Load stats
                val statsResp = ApiClient.api.getStats()
                if (statsResp.isSuccessful) {
                    val stats = statsResp.body()!!
                    binding.tvTotalOrders.text = stats.totalOrders.toString()
                    val profit = stats.totalProfit
                    binding.tvTotalProfit.text = if (profit >= 0)
                        "+%.0f ر.س".format(profit)
                    else "%.0f ر.س".format(profit)
                    binding.tvTotalProfit.setTextColor(
                        resources.getColor(
                            if (profit >= 0) com.example.amazontracker.R.color.profit_positive
                            else com.example.amazontracker.R.color.profit_negative,
                            null
                        )
                    )
                    binding.tvDelivered.text = (stats.byStatus["delivered"] ?: 0).toString()
                    binding.tvShipped.text = (stats.byStatus["shipped"] ?: 0).toString()
                    binding.tvPending.text = (stats.byStatus["pending"] ?: 0).toString()
                }

                // Load recent orders (limit 5)
                val ordersResp = ApiClient.api.getOrders(limit = 5)
                if (ordersResp.isSuccessful) {
                    adapter.submitList(ordersResp.body()?.orders ?: emptyList())
                }
            } catch (e: Exception) {
                Snackbar.make(binding.root, "⚠️ تعذّر الاتصال: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show()
            } finally {
                binding.swipeRefresh.isRefreshing = false
            }
        }
    }

    private fun triggerSync() {
        lifecycleScope.launch {
            try {
                binding.syncStatusLayout.visibility = View.VISIBLE
                binding.tvSyncMessage.text = "⚙️ تهيئة المزامنة…"
                binding.syncProgress.isIndeterminate = true

                val resp = ApiClient.api.syncNow()
                if (resp.isSuccessful) {
                    binding.tvSyncMessage.text = "✅ ${resp.body()?.message ?: "بدأت المزامنة"}"
                    binding.syncProgress.isIndeterminate = false
                    binding.syncProgress.progress = 100
                    pollSyncStatus()
                } else {
                    binding.tvSyncMessage.text = "❌ فشلت المزامنة"
                }
            } catch (e: Exception) {
                binding.tvSyncMessage.text = "❌ خطأ: ${e.localizedMessage}"
            } finally {
                binding.btnSync.isEnabled = true
                binding.btnSync.text = "🔄  مزامنة الطلبات الآن"
            }
        }
    }

    private fun pollSyncStatus() {
        lifecycleScope.launch {
            repeat(10) {
                delay(3000)
                try {
                    val s = ApiClient.api.getSyncStatus()
                    if (s.isSuccessful) {
                        val status = s.body()!!
                        binding.tvSyncMessage.text = status.message ?: "جاري المزامنة…"
                        binding.syncProgress.progress = status.progress
                        if (!status.isSyncing) {
                            delay(1500)
                            binding.syncStatusLayout.visibility = View.GONE
                            return@launch
                        }
                    }
                } catch (_: Exception) {}
            }
            binding.syncStatusLayout.visibility = View.GONE
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
