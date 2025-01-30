interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center gap-2 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 border border-gray-700 rounded disabled:opacity-50 bg-gray-800 text-gray-200 hover:bg-gray-700"
      >
        Previous
      </button>

      <span className="px-3 py-1 text-gray-300">
        Page {currentPage} of {totalPages}
      </span>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 border border-gray-700 rounded disabled:opacity-50 bg-gray-800 text-gray-200 hover:bg-gray-700"
      >
        Next
      </button>
    </div>
  );
}
