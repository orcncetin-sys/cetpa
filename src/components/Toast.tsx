import React from 'react';
export const ToastProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const useToast = () => (_msg: string, _type: string) => {};
