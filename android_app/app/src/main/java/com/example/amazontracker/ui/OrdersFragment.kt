package com.example.amazontracker.ui

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.amazontracker.api.ApiClient
import com.example.amazontracker.api.Order
import com.example.amazontracker.databinding.FragmentOrdersBinding
import com.example.amazontracker.ui.adapter.OrderAdapter
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class OrdersFragment : Fragment() {

    private var _binding: FragmentOrdersBinding? = null
    private val binding get() = _binding!!
    private lateinit var adapter: OrderAdapter
    private var allOrders: List<Order> = emptyList()
    private var currentStatus: String? = null
    private var searchJob: Job? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentOrdersBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = OrderAdapter()
        binding.rvOrders.layoutManager = LinearLayoutManager(requireContext())
        binding.rvOrders.adapter = adapter

        binding.swipeRefresh.setColorSchemeResources(android.R.color.holo_orange_dark)
        binding.swipeRefresh.setOnRefreshListener { loadOrders() }

        // Status filter chips
        binding.chipAll.setOnClickListener { currentStatus = null; loadOrders() }
        binding.chipDelivered.setOnClickListener { currentStatus = "delivered"; loadOrders() }
        binding.chipShipped.setOnClickListener { currentStatus = "shipped"; loadOrders() }
        binding.chipPending.setOnClickListener { currentStatus = "pending"; loadOrders() }
        binding.chipCancelled.setOnClickListener { currentStatus = "cancelled"; loadOrders() }

        // Search with debounce
        binding.etSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {
                searchJob?.cancel()
                searchJob = lifecycleScope.launch {
                    delay(300)
                    filterList(s?.toString() ?: "")
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        loadOrders()
    }

    private fun loadOrders() {
        binding.progressLoading.visibility = View.VISIBLE
        binding.emptyState.visibility = View.GONE

        lifecycleScope.launch {
            try {
                val resp = ApiClient.api.getOrders(status = currentStatus, limit = 200)
                if (resp.isSuccessful) {
                    allOrders = resp.body()?.orders ?: emptyList()
                    val total = resp.body()?.total ?: 0
                    binding.tvOrdersCount.text = "إجمالي الطلبات: $total"
                    filterList(binding.etSearch.text?.toString() ?: "")
                } else {
                    Snackbar.make(binding.root, "❌ خطأ في جلب الطلبات", Snackbar.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Snackbar.make(binding.root, "⚠️ تعذّر الاتصال: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show()
            } finally {
                binding.progressLoading.visibility = View.GONE
                binding.swipeRefresh.isRefreshing = false
            }
        }
    }

    private fun filterList(query: String) {
        val filtered = if (query.isBlank()) allOrders
        else allOrders.filter {
            it.productName?.contains(query, ignoreCase = true) == true ||
            it.amazonOrderId?.contains(query, ignoreCase = true) == true ||
            it.trackingNumber?.contains(query, ignoreCase = true) == true
        }
        adapter.submitList(filtered)
        binding.emptyState.visibility = if (filtered.isEmpty()) View.VISIBLE else View.GONE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
