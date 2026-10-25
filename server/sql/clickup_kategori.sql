-- =====================================================================
-- ClickUp Late Tracker - Kategori Keterlambatan
-- Jalankan langsung di database (db_zeri). Tidak perlu migrate.js.
-- =====================================================================

-- 1. Master Kategori
-- DROP TABLE IF EXISTS public.clickup_task_kategori;
-- DROP TABLE IF EXISTS public.clickup_kategori;

CREATE TABLE IF NOT EXISTS public.clickup_kategori (
	id int8 GENERATED ALWAYS AS IDENTITY( INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
	nama_kategori varchar(100) NOT NULL,
	deskripsi text NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT clickup_kategori_pkey PRIMARY KEY (id)
);

-- 2. Isi data master (ID dipertahankan sesuai data asli)
INSERT INTO public.clickup_kategori (id, nama_kategori, deskripsi, is_active, created_at, updated_at)
OVERRIDING SYSTEM VALUE
VALUES
	(1, 'Requirement & Scenario',   'Unclear requirement, change request, wrong test scenario, incomplete test scenario', true, '2026-10-09 10:15:48.210', '2026-10-09 10:15:48.210'),
	(2, 'Defect & Quality',         'Development bug, failed retest, bug leakage (DFT to UAT)', true, '2026-10-09 10:15:49.466', '2026-10-09 10:15:49.466'),
	(3, 'Dependency & Environment', 'Test data not ready, environment issue, deployment/build delay', true, '2026-10-09 10:15:49.547', '2026-10-09 10:15:49.547'),
	(4, 'Capacity & Planning',      'Insufficient time or capacity, Underestimated effort, team/PIC capacity, shifting priorities, task not started', true, '2026-10-12 08:57:34.269', '2026-10-12 08:57:34.269'),
	(5, 'Stakeholder & Approval',   'Waiting for user/business confirmation, approval pending, user UAT schedule not available', true, '2026-10-12 08:57:34.269', '2026-10-12 08:57:34.269'),
	(6, 'Status Not Updated',       'Work already completed but ClickUp card/status not moved or updated on time', true, '2026-10-12 09:51:44.885', '2026-10-12 09:51:44.885')
ON CONFLICT (id) DO UPDATE SET
	nama_kategori = EXCLUDED.nama_kategori,
	deskripsi     = EXCLUDED.deskripsi,
	is_active     = EXCLUDED.is_active,
	updated_at    = CURRENT_TIMESTAMP;

-- Sinkronkan sequence identity agar insert berikutnya mulai dari id 7
SELECT setval(
	pg_get_serial_sequence('public.clickup_kategori', 'id'),
	(SELECT COALESCE(MAX(id), 1) FROM public.clickup_kategori)
);

-- 3. Relasi Task (Card BRD ClickUp) -> Kategori
--    1 card = 1 kategori. Dipilih dari kolom "Kategori" di Late Tracker.
CREATE TABLE IF NOT EXISTS public.clickup_task_kategori (
	task_id varchar(50) NOT NULL,
	kategori_id int8 NOT NULL,
	created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT clickup_task_kategori_pkey PRIMARY KEY (task_id),
	CONSTRAINT clickup_task_kategori_kategori_fk FOREIGN KEY (kategori_id)
		REFERENCES public.clickup_kategori(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clickup_task_kategori_kategori_id
	ON public.clickup_task_kategori (kategori_id);

-- Contoh tambah kategori baru nanti (id otomatis):
-- INSERT INTO public.clickup_kategori (nama_kategori, deskripsi) VALUES ('Nama Kategori', 'Deskripsi');
