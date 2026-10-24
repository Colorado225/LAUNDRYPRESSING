-- =============================================================================
-- 012_cinetpay_atomic.sql — finalisation atomique des paiements Mobile Money
-- =============================================================================
-- La confirmation CinetPay doit mettre à jour payment_transactions ET orders
-- dans la même transaction PostgreSQL. En cas d'échec d'une des écritures,
-- PostgreSQL annule les deux ; une notification rejouée peut donc réparer sans
-- laisser une commande payée avec son journal en attente (ou l'inverse).
-- =============================================================================

create or replace function public.finalize_cinetpay_payment(
  p_transaction_id uuid,
  p_amount integer,
  p_payment_method text default null,
  p_operator_label text default null,
  p_signature_verified boolean default false,
  p_provider_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_paid_at timestamptz := now();
  v_was_paid boolean;
begin
  if p_transaction_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'Identifiant ou montant de paiement invalide.'
      using errcode = '22023';
  end if;

  select *
    into v_payment
    from public.payment_transactions
   where id = p_transaction_id
     and provider = 'cinetpay'
   for update;

  if not found then
    raise exception 'Transaction CinetPay introuvable.'
      using errcode = 'P0002';
  end if;

  if v_payment.amount <> p_amount then
    raise exception 'Le montant vérifié ne correspond pas à la transaction.'
      using errcode = '22023';
  end if;

  if p_payment_method is not null and p_payment_method not in (
    'wave', 'orange_money', 'mtn_momo', 'moov_money', 'cash'
  ) then
    raise exception 'Moyen de paiement non reconnu.'
      using errcode = '22023';
  end if;

  v_was_paid := v_payment.status = 'paid';

  if not v_was_paid then
    update public.payment_transactions
       set status = 'paid',
           payment_method = coalesce(p_payment_method, payment_method),
           operator_label = coalesce(p_operator_label, operator_label),
           signature_verified = p_signature_verified,
           provider_payload = coalesce(p_provider_payload, provider_payload),
           paid_at = v_paid_at
     where id = p_transaction_id;
  end if;

  -- Toujours appliquer/réparer la commande, y compris en cas de replay.
  update public.orders
     set payment_status = 'paid',
         payment_method = coalesce(p_payment_method, payment_method),
         updated_at = v_paid_at
   where id = v_payment.order_id
     and tenant_id = v_payment.tenant_id;

  if not found then
    raise exception 'Commande associée à la transaction introuvable.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'status', case when v_was_paid then 'already_paid' else 'paid' end,
    'transaction_id', p_transaction_id,
    'order_id', v_payment.order_id,
    'repaired_order', v_was_paid
  );
end;
$$;

revoke all on function public.finalize_cinetpay_payment(uuid, integer, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_cinetpay_payment(uuid, integer, text, text, boolean, jsonb)
  to service_role;

comment on function public.finalize_cinetpay_payment(uuid, integer, text, text, boolean, jsonb) is
  'Finalise de façon atomique une transaction CinetPay vérifiée et marque sa commande payée ; service_role uniquement.';
