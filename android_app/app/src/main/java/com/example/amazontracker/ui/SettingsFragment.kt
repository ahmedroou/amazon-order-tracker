package com.example.amazontracker.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.example.amazontracker.api.ApiClient
import com.example.amazontracker.databinding.FragmentSettingsBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        checkServerStatus()

        binding.btnSyncQuick.setOnClickListener { triggerSync(ai = false) }
        binding.btnSyncAi.setOnClickListener { triggerSync(ai = true) }
        binding.btnExport.setOnClickListener { openExport() }
    }

    private fun checkServerStatus() {
        lifecycleScope.launch {
            try {
                val resp = ApiClient.api.getSyncStatus()
                if (resp.isSuccessful) {
                    val s = resp.body()!!
                    binding.tvServerStatus.text = if (s.isSyncing)
                        "🔄 يعمل — جاري المزامنة (${s.progress}%)"
                    else "✅ يعمل بشكل طبيعي"
                }
            } catch (e: Exception) {
                binding.tvServerStatus.text = "❌ لا يمكن الوصول للخادم"
            }
        }
    }

    private fun triggerSync(ai: Boolean) {
        val btn = if (ai) binding.btnSyncAi else binding.btnSyncQuick
        btn.isEnabled = false
        binding.cardSyncStatus.visibility = View.VISIBLE
        binding.syncProgress.isIndeterminate = true

        lifecycleScope.launch {
            try {
                val resp = if (ai) ApiClient.api.syncAI() else ApiClient.api.syncNow()
                if (resp.isSuccessful) {
                    val msg = resp.body()?.message ?: "بدأت المزامنة"
                    binding.tvSyncMsg.text = "⚙️ $msg"
                    pollSyncStatus()
                } else {
                    binding.tvSyncMsg.text = "❌ فشلت المزامنة"
                    binding.cardSyncStatus.visibility = View.GONE
                }
            } catch (e: Exception) {
                Snackbar.make(binding.root, "⚠️ ${e.localizedMessage}", Snackbar.LENGTH_LONG).show()
                binding.cardSyncStatus.visibility = View.GONE
            } finally {
                btn.isEnabled = true
            }
        }
    }

    private fun pollSyncStatus() {
        lifecycleScope.launch {
            repeat(20) {
                delay(3000)
                try {
                    val resp = ApiClient.api.getSyncStatus()
                    if (resp.isSuccessful) {
                        val s = resp.body()!!
                        binding.tvSyncMsg.text = s.message ?: "جاري المزامنة…"
                        binding.syncProgress.isIndeterminate = false
                        binding.syncProgress.progress = s.progress
                        if (!s.isSyncing) {
                            binding.tvSyncMsg.text = "✅ اكتملت المزامنة بنجاح"
                            delay(2000)
                            binding.cardSyncStatus.visibility = View.GONE
                            return@launch
                        }
                    }
                } catch (_: Exception) {}
            }
            binding.cardSyncStatus.visibility = View.GONE
        }
    }

    private fun openExport() {
        val url = "https://84.8.102.52.sslip.io/api/orders/export"
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
